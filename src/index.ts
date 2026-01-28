import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, UserMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { Config, loadConfig, ConfigSelectorComponent } from "./config";
import { SyncClient } from "./client";
import { debugLog } from "./debug";
import { SessionState } from "./state";
import {
  transformSession,
  transformUserMessage,
  transformAssistantMessage,
  extractUserMessageText,
  countToolCalls,
} from "./transform";
import type { MessagePayload } from "./types";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();

  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null, null);
    return;
  }

  if (config.autoSync === false) {
    if (config.debug) {
      debugLog({ type: "init", message: "Auto-sync disabled in config" });
    }
    registerConfigCommand(pi, config, null);
    return;
  }

  const client = new SyncClient(config);
  let state: SessionState | null = null;

  const log = (entry: Record<string, unknown>) => {
    if (config.debug) {
      debugLog(entry);
    }
  };

  const notifyError = (ctx: ExtensionContext, message: string) => {
    if (config.debug && ctx.hasUI) {
      ctx.ui.notify(`[OpenSync] ${message}`, "error");
    }
    log({ type: "error", message });
  };

  registerConfigCommand(pi, config, client);

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const model = ctx.model ? { id: ctx.model.id, provider: ctx.model.provider } : undefined;

    state = new SessionState(sessionId, ctx.cwd, model);

    // Check if session has existing messages (resume scenario)
    // Restore state to avoid message ID conflicts
    let msgCount = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message") {
        msgCount++;
        const msg = entry.message;

        // Restore usage stats from assistant messages
        if (msg.role === "assistant") {
          const assistantMsg = msg as AssistantMessage;
          if (assistantMsg.usage) {
            state.updateUsage(assistantMsg.usage);
          }

          // Restore tool call count
          const toolCalls = countToolCalls(assistantMsg.content);
          if (toolCalls > 0) {
            state.incrementToolCallCount(toolCalls);
          }
        }
      }
    }

    if (msgCount > 0) {
      state.messageCount = msgCount;
      log({ type: "session_resume", sessionId: state.externalId, messageCount: msgCount, promptTokens: state.promptTokens, completionTokens: state.completionTokens });
    } else {
      log({ type: "session_start", sessionId: state.externalId });
    }

    // Update status
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-opensync", ctx.ui.theme.fg("dim", "● OpenSync"));
    }

    // Sync session (resume will update existing, new will create)
    const sessionName = ctx.sessionManager.getSessionName();
    const payload = transformSession(state, sessionName);
    const result = await client.syncSession(payload);

    if (!result.success) {
      notifyError(ctx, `Failed to sync session: ${result.error}`);
      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-opensync", ctx.ui.theme.fg("error", "● Sync error"));
      }
    }
  });

  pi.on("session_fork", async (_event, ctx) => {
    // Get the parent session ID before we create new state
    const parentExternalId = state?.externalId;

    const sessionId = ctx.sessionManager.getSessionId();
    const model = ctx.model ? { id: ctx.model.id, provider: ctx.model.provider } : undefined;

    state = new SessionState(sessionId, ctx.cwd, model, parentExternalId);
    log({ type: "session_fork", sessionId: state.externalId, parentSessionId: parentExternalId });

    // Sync new forked session
    const sessionName = ctx.sessionManager.getSessionName();
    const payload = transformSession(state, sessionName);
    await client.syncSession(payload);

    // Batch sync all existing messages in the fork
    const messages: MessagePayload[] = [];
    let msgCount = 0;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message") {
        const msg = entry.message;
        msgCount++;

        if (msg.role === "user") {
          const userMsg = msg as UserMessage;
          const text = extractUserMessageText(userMsg.content);
          messages.push(transformUserMessage(
            sessionId,
            state.generateMessageId("user"),
            text,
            userMsg.timestamp
          ));
        } else if (msg.role === "assistant") {
          const assistantMsg = msg as AssistantMessage;
          messages.push(transformAssistantMessage(
            sessionId,
            state.generateMessageId("assistant"),
            assistantMsg,
            config.syncThinking
          ));

          // Update state with usage
          if (assistantMsg.usage) {
            state.updateUsage(assistantMsg.usage);
          }

          // Count tool calls
          const toolCalls = countToolCalls(assistantMsg.content);
          if (toolCalls > 0) {
            state.incrementToolCallCount(toolCalls);
          }
        }
      }
    }

    // Update message count
    state.messageCount = msgCount;

    if (messages.length > 0) {
      log({ type: "batch_sync", messageCount: messages.length, reason: "fork" });
      // Remove createdAt from messages - batch endpoint doesn't accept it
      const batchMessages = messages.map(({ createdAt, ...rest }) => rest);
      await client.syncBatch([], batchMessages);
    }

    // Sync updated session with totals
    const updatedPayload = transformSession(state, sessionName);
    await client.syncSession(updatedPayload);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!state) return;

    log({ type: "session_shutdown", sessionId: state.externalId });

    // Sync final session state
    const sessionName = ctx.sessionManager.getSessionName();
    const payload = transformSession(state, sessionName, true);
    await client.syncSession(payload);

    state = null;
  });

  // Model change tracking
  pi.on("model_select", async (event, _ctx) => {
    if (!state) return;

    state.updateModel({ id: event.model.id, provider: event.model.provider });
    log({ type: "model_change", model: state.model, provider: state.provider });
  });

  pi.on("input", async (event, ctx) => {
    if (!state) return;
    if (event.source === "extension") return; // Skip extension-injected messages

    state.incrementMessageCount();
    const messageId = state.generateMessageId("user");

    log({ type: "user_message", messageId, messageCount: state.messageCount });

    const payload = transformUserMessage(
      state.externalId,
      messageId,
      event.text
    );

    const result = await client.syncMessage(payload);
    if (!result.success) {
      notifyError(ctx, `Failed to sync user message: ${result.error}`);
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!state) return;

    const msg = event.message;
    if (msg.role !== "assistant") return;

    const assistantMsg = msg as AssistantMessage;

    state.incrementMessageCount();
    const messageId = state.generateMessageId("assistant");

    log({ type: "assistant_message", messageId, messageCount: state.messageCount });

    // Update usage
    if (assistantMsg.usage) {
      state.updateUsage(assistantMsg.usage);
    }

    // Count and track tool calls
    const toolCalls = countToolCalls(assistantMsg.content);
    if (toolCalls > 0) {
      state.incrementToolCallCount(toolCalls);
    }

    // Sync assistant message with tool results included as parts (if enabled)
    const toolResults = (config.syncToolCalls !== false) ? event.toolResults as ToolResultMessage[] : [];
    const payload = transformAssistantMessage(
      state.externalId,
      messageId,
      assistantMsg,
      config.syncThinking,
      toolResults
    );
    const msgResult = await client.syncMessage(payload);
    if (!msgResult.success) {
      notifyError(ctx, `Failed to sync assistant message: ${msgResult.error}`);
    }

    // Update session with current totals
    const sessionName = ctx.sessionManager.getSessionName();
    const sessionPayload = transformSession(state, sessionName);
    const sessResult = await client.syncSession(sessionPayload);
    if (!sessResult.success) {
      notifyError(ctx, `Failed to update session: ${sessResult.error}`);
    }
  });
}

function registerConfigCommand(pi: ExtensionAPI, currentConfig: Config | null, _client: SyncClient | null) {
  pi.registerCommand("opensync:config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Config command requires interactive mode", "error");
        return;
      }

      // If no config, show setup prompt
      if (!currentConfig) {
        const setup = await ctx.ui.confirm(
          "No Configuration",
          "OpenSync is not configured. Set up now?"
        );
        if (!setup) return;
      }

      await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
        const component = new ConfigSelectorComponent(
          currentConfig,
          ctx,
          {
            onClose: () => done(),
            requestRender: () => tui.requestRender(),
          }
        );

        return {
          render(width: number) {
            return component.render(width);
          },
          invalidate() {
            component.invalidate();
          },
          handleInput(data: string) {
            component.handleInput(data);
            tui.requestRender();
          },
        };
      });
    },
  });
}
