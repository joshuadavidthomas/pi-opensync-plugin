import { basename } from "node:path";
import { appendFileSync } from "node:fs";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config";

/**
 * Session metadata for syncing to OpenSync
 */
export interface SessionData {
  sessionId: string;
  projectPath: string;
  parentSessionId?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  messageCount?: number;
  startedAt?: number;
}

/**
 * User message data for syncing
 */
export interface UserMessageData {
  role: "user";
  sessionId: string;
  messageId: string;
  text: string;
  timestamp?: number;
}

/**
 * Assistant message data for syncing
 */
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

/**
 * Tool result data included with assistant messages
 */
export interface ToolResultData {
  toolName: string;
  content: { type: "text"; text: string }[];
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  error?: string;
}

/**
 * Text content part from assistant message
 */
interface TextContent {
  type: "text";
  text: string;
}

/**
 * Thinking/reasoning content part from assistant message
 */
interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/**
 * Tool call content part from assistant message
 */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}

/**
 * Union of content part types in assistant messages
 */
type AssistantContentPart = TextContent | ThinkingContent | ToolCallContent;

/**
 * API payload format for session sync endpoint
 */
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

/**
 * Text part in message payload
 */
interface TextPart {
  type: "text";
  content: string;
}

/**
 * Tool call part in message payload
 */
interface ToolCallPart {
  type: "tool-call";
  content: { toolName: string; args: unknown };
}

/**
 * Tool result part in message payload
 */
interface ToolResultPart {
  type: "tool-result";
  content: string;
}

/**
 * Thinking part in message payload
 */
interface ThinkingPart {
  type: "thinking";
  content: string;
}

/**
 * Structured content part in message payload (tool calls, thinking, etc.)
 */
type MessagePart = TextPart | ToolCallPart | ToolResultPart | ThinkingPart;

/**
 * API payload format for message sync endpoint
 */
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
    this.apiKey = config.apiKey;
    this.debug = config.debug;
    // Convex dashboard shows .convex.cloud URLs, but HTTP endpoints use .convex.site
    this.siteUrl = config.convexUrl.replace(".convex.cloud", ".convex.site");
  }

  /**
   * Sync multiple messages in a single batch request
   */
  async syncBatch(messages: MessageData[]): Promise<SyncResult> {
    const messagePayloads = messages.map((m) => this.buildMessagePayload(m));
    return this.request("/sync/batch", { sessions: [], messages: messagePayloads });
  }

  /**
   * Sync a single message (user or assistant)
   */
  async syncMessage(message: MessageData): Promise<SyncResult> {
    return this.request("/sync/message", this.buildMessagePayload(message));
  }

  /**
   * Transform domain message data into API payload format
   */
  private buildMessagePayload(message: MessageData): MessagePayload {
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

      // Extract plain text from content parts
      const textParts: string[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "thinking" && includeThinking) {
          textParts.push(`<thinking>\n${part.thinking}\n</thinking>\n`);
        }
      }
      const textContent = textParts.join("\n");

      payload.textContent = textContent || undefined;
      payload.model = message.model;

      if (message.usage) {
        payload.promptTokens = message.usage.input;
        payload.completionTokens = message.usage.output;
      }

      const parts = this.buildParts(message, textContent, includeThinking);
      if (parts.length > 0) payload.parts = parts;
    }

    return payload;
  }

  /**
   * Sync session metadata (title, model, usage stats, etc.)
   */
  async syncSession(
    session: SessionData,
    ctx: ExtensionContext,
    isFinal = false
  ): Promise<SyncResult> {
    let title = ctx.sessionManager.getSessionName() || "Untitled";
    if (session.parentSessionId) {
      title = `[Fork::${session.parentSessionId.slice(0, 8)}] ${title}`;
    }

    const payload: SessionPayload = {
      externalId: session.sessionId,
      source: "pi",
      projectPath: session.projectPath,
      projectName: basename(session.projectPath),
      title,
    };

    if (session.model) payload.model = session.model;
    if (session.provider) payload.provider = session.provider;

    if ((session.promptTokens ?? 0) > 0 || (session.completionTokens ?? 0) > 0) {
      payload.promptTokens = session.promptTokens;
      payload.completionTokens = session.completionTokens;
      payload.totalTokens = (session.promptTokens ?? 0) + (session.completionTokens ?? 0);
    }

    if ((session.cost ?? 0) > 0) payload.cost = session.cost;
    if ((session.messageCount ?? 0) > 0) payload.messageCount = session.messageCount;
    if (isFinal && session.startedAt) {
      payload.durationMs = Date.now() - session.startedAt;
    }

    return this.request("/sync/session", payload);
  }

  /**
   * Test API connectivity via health endpoint
   */
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

  /**
   * Write debug log entry to .pi/opensync-debug.jsonl
   */
  private log(entry: Record<string, unknown>): void {
    if (!this.debug) return;
    try {
      const logEntry = { timestamp: new Date().toISOString(), ...entry };
      appendFileSync(".pi/opensync-debug.jsonl", JSON.stringify(logEntry) + "\n");
    } catch { } // Silently fail if we can't write logs
  }

  /**
   * Make authenticated POST request to OpenSync API
   */
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
