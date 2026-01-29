import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { loadConfig, ConfigSelectorComponent } from "./config";
import { SyncClient } from "./client";
import type { MessageData, ToolResultData } from "./client";

/**
 * Session state tracked in memory during a session's lifetime.
 * Accumulates usage statistics and message counts for sync updates.
 */
interface SessionState {
  sessionId: string;
  parentSessionId?: string;
  projectPath: string;
  model?: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  messageCount: number;
  toolCallCount: number;
  startedAt: number;
}

/**
 * Stats accumulated from processing a branch of messages.
 */
interface BranchStats {
  messageCount: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  toolCallCount: number;
}

/**
 * Process existing messages in a branch to extract stats and build message payloads.
 * Used when resuming a session or processing a fork to sync existing messages.
 */
function processBranch(
  ctx: ExtensionContext,
  config: { syncThinking: boolean }
): { stats: BranchStats; messages: MessageData[] } {
  const branch = ctx.sessionManager.getBranch();
  const sessionId = ctx.sessionManager.getSessionId();
  const includeThinking = config.syncThinking;

  const stats: BranchStats = {
    messageCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    toolCallCount: 0,
  };
  const messages: MessageData[] = [];

  for (const entry of branch) {
    if (entry.type !== "message") continue;

    const msg = entry.message;

    // Skip tool results - we only sync user and assistant messages
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    stats.messageCount++;

    if (msg.role === "user") {
      const userMsg = msg;
      const text =
        typeof userMsg.content === "string"
          ? userMsg.content
          : userMsg.content
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join("\n");

      messages.push({
        role: "user",
        sessionId,
        messageId: `${sessionId}-user-${stats.messageCount}`,
        text,
        timestamp: userMsg.timestamp,
      });
    } else if (msg.role === "assistant") {
      const assistantMsg = msg;

      messages.push({
        role: "assistant",
        sessionId,
        messageId: `${sessionId}-assistant-${stats.messageCount}`,
        content: assistantMsg.content,
        model: assistantMsg.model,
        timestamp: assistantMsg.timestamp,
        usage: assistantMsg.usage,
        includeThinking,
      });

      if (assistantMsg.usage) {
        stats.promptTokens += assistantMsg.usage.input;
        stats.completionTokens += assistantMsg.usage.output;
        stats.cost += assistantMsg.usage.cost.total;
      }
      stats.toolCallCount += assistantMsg.content.filter((p) => p.type === "toolCall").length;
    }
  }

  return { stats, messages };
}

/**
 * Main plugin entry point. Registers event handlers for session lifecycle
 * and message events to sync with OpenSync.
 */
export default function piOpensyncPlugin(pi: ExtensionAPI) {
  registerConfigCommand(pi);

  const config = loadConfig();
  if (!config) return;
  if (config.autoSync === false) return;

  const client = new SyncClient(config);
  let state: SessionState | null = null;

  pi.on("session_start", async (_event, ctx) => {
    // Process existing messages to restore stats (resume scenario)
    const { stats } = processBranch(ctx, config);

    state = {
      sessionId: ctx.sessionManager.getSessionId(),
      projectPath: ctx.cwd,
      model: ctx.model?.id,
      provider: ctx.model?.provider,
      ...stats,
      startedAt: Date.now(),
    };

    const result = await client.syncSession(state, ctx);

    if (!result.success) {
      notifyError(ctx, `Failed to sync session: ${result.error}`);
    }
  });

  pi.on("session_fork", async (_event, ctx) => {
    const parentSessionId = state?.sessionId;

    // Process existing messages to get stats and build message payloads
    const { stats, messages } = processBranch(ctx, config);

    state = {
      sessionId: ctx.sessionManager.getSessionId(),
      parentSessionId,
      projectPath: ctx.cwd,
      model: ctx.model?.id,
      provider: ctx.model?.provider,
      ...stats,
      startedAt: Date.now(),
    };

    await client.syncSession(state, ctx);

    if (messages.length > 0) {
      await client.syncBatch(messages);
    }

    await client.syncSession(state, ctx);
  });

  /**
   * Sync final session state on shutdown
   */
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!state) return;

    await client.syncSession(state, ctx, true);

    state = null;
  });

  /**
   * Track model changes for session metadata
   */
  pi.on("model_select", async (event, _ctx) => {
    if (!state) return;
    state.model = event.model.id;
    state.provider = event.model.provider;
  });

  /**
   * Sync user messages as they're sent
   */
  pi.on("input", async (event, ctx) => {
    if (!state) return;
    if (event.source === "extension") return;

    state.messageCount++;

    const result = await client.syncMessage({
      role: "user",
      sessionId: state.sessionId,
      messageId: `${state.sessionId}-user-${state.messageCount}`,
      text: event.text,
    });

    if (!result.success) {
      notifyError(ctx, `Failed to sync message: ${result.error}`);
    }
  });

  /**
   * Sync assistant messages and update session stats after each turn
   */
  pi.on("turn_end", async (event, ctx) => {
    if (!state) return;
    if (event.message.role !== "assistant") return;

    const msg = event.message as AssistantMessage;

    state.messageCount++;

    if (msg.usage) {
      state.promptTokens += msg.usage.input;
      state.completionTokens += msg.usage.output;
      state.cost += msg.usage.cost.total;
    }
    state.toolCallCount += msg.content.filter((p) => p.type === "toolCall").length;

    // Convert tool results to our format
    const toolResults: ToolResultData[] =
      config.syncToolCalls !== false
        ? (event.toolResults as ToolResultMessage[]).map((tr) => ({
          toolName: tr.toolName,
          content: tr.content.filter((c) => c.type === "text") as { type: "text"; text: string }[],
        }))
        : [];

    const msgResult = await client.syncMessage({
      role: "assistant",
      sessionId: state.sessionId,
      messageId: `${state.sessionId}-assistant-${state.messageCount}`,
      content: msg.content,
      model: msg.model,
      timestamp: msg.timestamp,
      usage: msg.usage,
      toolResults,
      includeThinking: config.syncThinking,
    });

    if (!msgResult.success) {
      notifyError(ctx, `Failed to sync message: ${msgResult.error}`);
    }

    const sessResult = await client.syncSession(state, ctx);

    if (!sessResult.success) {
      notifyError(ctx, `Failed to update session: ${sessResult.error}`);
    }
  });
}

/**
 * Show error notification to user.
 */
function notifyError(ctx: ExtensionContext, message: string) {
  if (ctx.hasUI) {
    ctx.ui.notify(`[OpenSync] ${message}`, "error");
  }
}

/**
 * Register the /opensync:config command for interactive configuration.
 */
function registerConfigCommand(pi: ExtensionAPI) {
  pi.registerCommand("opensync:config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const currentConfig = loadConfig();

      if (!currentConfig) {
        const setup = await ctx.ui.confirm("No Configuration", "OpenSync is not configured. Set up now?");
        if (!setup) return;
      }

      await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
        const component = new ConfigSelectorComponent(
          currentConfig,
          ctx,
          { onClose: () => done(), requestRender: () => tui.requestRender() }
        );

        return {
          render(width: number) { return component.render(width); },
          invalidate() { component.invalidate(); },
          handleInput(data: string) { component.handleInput(data); tui.requestRender(); },
        };
      });
    },
  });
}
