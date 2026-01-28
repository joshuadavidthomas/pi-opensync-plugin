import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, UserMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { loadConfig, getConfigPath } from "./config.js";
import { SyncClient } from "./client.js";
import {
  createSessionState,
  updateSessionUsage,
  incrementMessageCount,
  incrementToolCallCount,
  updateModel,
  generateMessageId,
} from "./state.js";
import {
  transformSession,
  transformUserMessage,
  transformAssistantMessage,
  transformToolResultMessage,
  extractUserMessageText,
  countToolCalls,
} from "./transform.js";
import type { SessionState, Config, MessagePayload } from "./types.js";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();
  
  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null, null);
    return;
  }
  
  if (config.autoSync === false) {
    if (config.debug) {
      console.log("[pi-opensync] Auto-sync disabled in config");
    }
    registerConfigCommand(pi, config, null);
    return;
  }
  
  const client = new SyncClient(config);
  let state: SessionState | null = null;
  
  const log = (...args: unknown[]) => {
    if (config.debug) {
      console.log("[pi-opensync]", ...args);
    }
  };
  
  // Register config command
  registerConfigCommand(pi, config, client);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Session lifecycle events
  // ─────────────────────────────────────────────────────────────────────────────
  
  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const model = ctx.model ? { id: ctx.model.id, provider: ctx.model.provider } : undefined;
    
    state = createSessionState(sessionId, ctx.cwd, model);
    log("Session started:", state.externalId);
    
    // Update status
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-opensync", ctx.ui.theme.fg("dim", "● OpenSync"));
    }
    
    // Sync initial session
    const sessionName = ctx.sessionManager.getSessionName();
    const payload = transformSession(state, sessionName);
    const result = await client.syncSession(payload);
    
    if (!result.success) {
      log("Failed to sync session:", result.error);
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
    
    state = createSessionState(sessionId, ctx.cwd, model, parentExternalId);
    log("Session forked:", state.externalId, "from parent:", parentExternalId);
    
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
            generateMessageId(sessionId, msgCount, "user"),
            text,
            userMsg.timestamp
          ));
        } else if (msg.role === "assistant") {
          const assistantMsg = msg as AssistantMessage;
          messages.push(transformAssistantMessage(
            sessionId,
            generateMessageId(sessionId, msgCount, "assistant"),
            assistantMsg,
            config.syncThinking
          ));
          
          // Update state with usage
          if (assistantMsg.usage) {
            state = updateSessionUsage(state, assistantMsg.usage);
          }
          
          // Count tool calls
          const toolCalls = countToolCalls(assistantMsg.content);
          if (toolCalls > 0) {
            state = incrementToolCallCount(state, toolCalls);
          }
        }
      }
    }
    
    // Update message count
    state = { ...state, messageCount: msgCount };
    
    if (messages.length > 0) {
      log("Syncing", messages.length, "existing messages to forked session");
      await client.syncBatch([], messages);
    }
    
    // Sync updated session with totals
    const updatedPayload = transformSession(state, sessionName);
    await client.syncSession(updatedPayload);
  });
  
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!state) return;
    
    log("Session shutdown:", state.externalId);
    
    // Sync final session state
    const sessionName = ctx.sessionManager.getSessionName();
    const payload = transformSession(state, sessionName, true);
    await client.syncSession(payload);
    
    // Clear status
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-opensync", undefined);
    }
    
    state = null;
  });
  
  // Model change tracking
  pi.on("model_select", async (event, _ctx) => {
    if (!state) return;
    
    state = updateModel(state, { id: event.model.id, provider: event.model.provider });
    log("Model changed:", state.model);
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Message events
  // ─────────────────────────────────────────────────────────────────────────────
  
  pi.on("input", async (event, _ctx) => {
    if (!state) return;
    if (event.source === "extension") return; // Skip extension-injected messages
    
    state = incrementMessageCount(state);
    const messageId = generateMessageId(state.externalId, state.messageCount, "user");
    
    log("User input:", messageId);
    
    const payload = transformUserMessage(
      state.externalId,
      messageId,
      event.text
    );
    
    await client.syncMessage(payload);
  });
  
  pi.on("turn_end", async (event, ctx) => {
    if (!state) return;
    
    const msg = event.message;
    if (msg.role !== "assistant") return;
    
    const assistantMsg = msg as AssistantMessage;
    
    state = incrementMessageCount(state);
    const messageId = generateMessageId(state.externalId, state.messageCount, "assistant");
    
    log("Assistant message:", messageId);
    
    // Update usage
    if (assistantMsg.usage) {
      state = updateSessionUsage(state, assistantMsg.usage);
    }
    
    // Count and track tool calls
    const toolCalls = countToolCalls(assistantMsg.content);
    if (toolCalls > 0) {
      state = incrementToolCallCount(state, toolCalls);
    }
    
    // Sync assistant message
    const payload = transformAssistantMessage(
      state.externalId,
      messageId,
      assistantMsg,
      config.syncThinking
    );
    await client.syncMessage(payload);
    
    // Optionally sync tool results
    if (config.syncToolCalls && event.toolResults.length > 0) {
      for (const toolResult of event.toolResults) {
        state = incrementMessageCount(state);
        const toolMsgId = generateMessageId(state.externalId, state.messageCount, "tool");
        
        const toolPayload = transformToolResultMessage(
          state.externalId,
          toolMsgId,
          toolResult as ToolResultMessage
        );
        await client.syncMessage(toolPayload);
      }
    }
    
    // Update session with current totals
    const sessionName = ctx.sessionManager.getSessionName();
    const sessionPayload = transformSession(state, sessionName);
    await client.syncSession(sessionPayload);
  });
}

function registerConfigCommand(pi: ExtensionAPI, config: Config | null, client: SyncClient | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      
      if (config && client) {
        const action = await ctx.ui.select("OpenSync Configuration", [
          "View current config",
          "Test connection",
          "Show config file path",
        ]);
        
        if (!action) return;
        
        switch (action) {
          case "View current config": {
            ctx.ui.notify(
              `Convex URL: ${config.convexUrl}\n` +
              `API Key: ${config.apiKey.slice(0, 8)}...\n` +
              `Auto Sync: ${config.autoSync !== false}\n` +
              `Sync Tool Calls: ${config.syncToolCalls ?? false}\n` +
              `Sync Thinking: ${config.syncThinking ?? false}\n` +
              `Debug: ${config.debug ?? false}`,
              "info"
            );
            break;
          }
          case "Test connection": {
            ctx.ui.notify("Testing connection...", "info");
            const result = await client.testConnection();
            if (result.success) {
              ctx.ui.notify("Connection successful!", "info");
            } else {
              ctx.ui.notify(`Connection failed: ${result.error}`, "error");
            }
            break;
          }
          case "Show config file path": {
            ctx.ui.notify(`Config file: ${getConfigPath()}`, "info");
            break;
          }
        }
      } else {
        ctx.ui.notify(
          `No config found.\n\nCreate config at:\n${getConfigPath()}\n\nOr set environment variables:\nPI_OPENSYNC_CONVEX_URL\nPI_OPENSYNC_API_KEY`,
          "info"
        );
      }
    },
  });
}
