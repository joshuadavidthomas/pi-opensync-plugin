/**
 * OpenSync API Client
 *
 * Handles communication with the OpenSync API endpoints for syncing
 * session metadata and messages. Transforms domain objects into the
 * API payload format expected by OpenSync.
 *
 * Debug logging (when enabled) writes to .pi/opensync-debug.jsonl
 */

import { basename } from "node:path";
import { appendFileSync } from "node:fs";
import type { Config } from "./config";

// ============================================================================
// Public Types - Used by callers to pass domain data
// ============================================================================

/** Session metadata for syncing to OpenSync */
export interface SessionData {
  sessionId: string;
  projectPath: string;
  parentSessionId?: string;
  title?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  messageCount?: number;
  startedAt?: number;
  isFinal?: boolean;
}

/** User message data for syncing */
export interface UserMessageData {
  role: "user";
  sessionId: string;
  messageId: string;
  text: string;
  timestamp?: number;
}

/** Assistant message data for syncing */
export interface AssistantMessageData {
  role: "assistant";
  sessionId: string;
  messageId: string;
  content: AssistantContentPart[];
  model: string;
  timestamp: number;
  usage?: { input: number; output: number };
  toolResults?: ToolResultData[];
  includeThinking?: boolean;
}

export type MessageData = UserMessageData | AssistantMessageData;

/** Tool result data included with assistant messages */
export interface ToolResultData {
  toolName: string;
  content: { type: "text"; text: string }[];
}

/** Result of a sync operation */
export interface SyncResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Internal Types - API payload formats
// ============================================================================

interface TextContent {
  type: "text";
  text: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}

type AssistantContentPart = TextContent | ThinkingContent | ToolCallContent;

interface SessionPayload {
  externalId: string;
  source: "pi";
  title?: string;
  projectPath?: string;
  projectName?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  messageCount?: number;
}

interface MessagePart {
  type: string;
  content: unknown;
}

interface MessagePayload {
  sessionExternalId: string;
  externalId: string;
  role: "user" | "assistant";
  textContent?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  createdAt?: number;
  parts?: MessagePart[];
}

/**
 * Client for syncing sessions and messages to OpenSync API.
 *
 * Transforms domain objects (SessionData, MessageData) into the payload
 * format expected by OpenSync endpoints. Handles authentication and
 * error responses.
 */
export class SyncClient {
  private siteUrl: string;
  private apiKey: string;
  private debug: boolean;

  constructor(config: Config) {
    this.siteUrl = config.convexUrl;
    this.apiKey = config.apiKey;
    this.debug = config.debug;
  }

  /** Sync multiple messages in a single batch request */
  async syncBatch(messages: MessageData[]): Promise<SyncResult> {
    const messagePayloads = messages.map((m) => {
      if (m.role === "user") {
        return {
          sessionExternalId: m.sessionId,
          externalId: m.messageId,
          role: "user" as const,
          textContent: m.text,
        };
      } else {
        const textContent = this.extractText(m.content, m.includeThinking ?? false);
        return {
          sessionExternalId: m.sessionId,
          externalId: m.messageId,
          role: "assistant" as const,
          textContent: textContent || undefined,
          model: m.model,
        };
      }
    });

    return this.request("/sync/batch", { sessions: [], messages: messagePayloads });
  }

  /** Sync a single message (user or assistant) */
  async syncMessage(message: MessageData): Promise<SyncResult> {
    const payload: MessagePayload = {
      sessionExternalId: message.sessionId,
      externalId: message.messageId,
      role: message.role,
      createdAt: message.timestamp ?? Date.now(),
    };

    if (message.role === "user") {
      payload.textContent = message.text;
    } else {
      const includeThinking = message.includeThinking ?? false;
      const textContent = this.extractText(message.content, includeThinking);

      payload.textContent = textContent || undefined;
      payload.model = message.model;

      if (message.usage) {
        payload.promptTokens = message.usage.input;
        payload.completionTokens = message.usage.output;
      }

      const parts = this.buildParts(message, textContent, includeThinking);
      if (parts.length > 0) payload.parts = parts;
    }

    return this.request("/sync/message", payload);
  }

  /** Sync session metadata (title, model, usage stats, etc.) */
  async syncSession(session: SessionData): Promise<SyncResult> {
    const payload: SessionPayload = {
      externalId: session.sessionId,
      source: "pi",
      projectPath: session.projectPath,
      projectName: basename(session.projectPath),
    };

    let title = session.title || "Untitled";
    if (session.parentSessionId) {
      title = `[Fork::${session.parentSessionId.slice(0, 8)}] ${title}`;
    }
    payload.title = title;

    if (session.model) payload.model = session.model;
    if (session.provider) payload.provider = session.provider;

    if ((session.promptTokens ?? 0) > 0 || (session.completionTokens ?? 0) > 0) {
      payload.promptTokens = session.promptTokens;
      payload.completionTokens = session.completionTokens;
      payload.totalTokens = (session.promptTokens ?? 0) + (session.completionTokens ?? 0);
    }

    if ((session.cost ?? 0) > 0) payload.cost = session.cost;
    if ((session.messageCount ?? 0) > 0) payload.messageCount = session.messageCount;
    if (session.isFinal && session.startedAt) {
      payload.durationMs = Date.now() - session.startedAt;
    }

    return this.request("/sync/session", payload);
  }

  /** Test API connectivity via health endpoint */
  async testConnection(): Promise<SyncResult> {
    try {
      const response = await fetch(`${this.siteUrl}/health`);
      if (response.ok) return { success: true };
      return { success: false, error: `Health check failed: ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Build message parts array for structured content (tool calls, thinking).
   * OpenSync UI only renders parts OR textContent, so we add text as the
   * first part when there's also structured content.
   */
  private buildParts(
    message: AssistantMessageData,
    textContent: string,
    includeThinking: boolean
  ): MessagePart[] {
    const parts: MessagePart[] = [];
    const toolResults = message.toolResults ?? [];

    const hasToolCalls = message.content.some((p) => p.type === "toolCall");
    const hasThinking = includeThinking && message.content.some((p) => p.type === "thinking");
    const hasToolResults = toolResults.length > 0;

    // Add text as a part if we also have structured content
    if (textContent && (hasToolCalls || hasThinking || hasToolResults)) {
      parts.push({ type: "text", content: textContent });
    }

    // Process content in order, interleaving tool results after their tool calls
    let resultIndex = 0;
    for (const part of message.content) {
      if (part.type === "toolCall") {
        parts.push({
          type: "tool-call",
          content: { toolName: part.name, args: part.arguments },
        });
        if (resultIndex < toolResults.length) {
          const result = toolResults[resultIndex];
          const resultText = result.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n");
          parts.push({ type: "tool-result", content: resultText });
          resultIndex++;
        }
      } else if (part.type === "thinking" && includeThinking) {
        parts.push({ type: "thinking", content: part.thinking });
      }
      // Skip text parts - already handled as textContent above
    }

    return parts;
  }

  /** Extract plain text from assistant content parts */
  private extractText(content: AssistantContentPart[], includeThinking: boolean): string {
    const parts: string[] = [];
    for (const part of content) {
      if (part.type === "text") {
        parts.push(part.text);
      } else if (part.type === "thinking" && includeThinking) {
        parts.push(`<thinking>${part.thinking}</thinking>`);
      }
    }
    return parts.join("\n");
  }

  /** Write debug log entry to .pi/opensync-debug.jsonl */
  private log(entry: Record<string, unknown>): void {
    if (!this.debug) return;
    try {
      const logEntry = { timestamp: new Date().toISOString(), ...entry };
      appendFileSync(".pi/opensync-debug.jsonl", JSON.stringify(logEntry) + "\n");
    } catch { } // Silently fail if we can't write logs
  }

  /** Make authenticated POST request to OpenSync API */
  private async request(endpoint: string, data: unknown): Promise<SyncResult> {
    const url = `${this.siteUrl}${endpoint}`;
    this.log({ type: "request", endpoint, payload: data });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        this.log({ type: "error", endpoint, status: response.status, error: text });
        return { success: false, error: `${response.status}: ${text}` };
      }

      const result = await response.json();
      this.log({ type: "success", endpoint, response: result });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log({ type: "exception", endpoint, error: message });
      return { success: false, error: message };
    }
  }
}
