/**
 * Session data for OpenSync API
 */
export interface SessionPayload {
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
 * Message part for structured content (tool calls, results, etc.)
 */
export interface MessagePart {
  type: string;
  content: unknown;
}

/**
 * Message data for OpenSync API
 */
export interface MessagePayload {
  sessionExternalId: string;
  externalId: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  textContent?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  createdAt?: number;
  parts?: MessagePart[];
}

/**
 * Result from OpenSync API calls
 */
export interface SyncResult {
  success: boolean;
  error?: string;
}
