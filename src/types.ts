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
 * Internal session state tracked by the extension
 */
export interface SessionState {
  /** OpenSync external ID (pi session UUID) */
  externalId: string;
  /** Parent session ID if this is a fork */
  parentExternalId?: string;
  /** Project working directory */
  projectPath: string;
  /** Project name (basename of projectPath) */
  projectName: string;
  /** Session start timestamp */
  startedAt: number;
  /** Current model ID */
  model?: string;
  /** Current model provider */
  provider?: string;
  /** Accumulated input tokens */
  promptTokens: number;
  /** Accumulated output tokens */
  completionTokens: number;
  /** Accumulated total cost */
  cost: number;
  /** Message counter for ID generation */
  messageCount: number;
  /** Tool call counter */
  toolCallCount: number;
}

/**
 * Result from OpenSync API calls
 */
export interface SyncResult {
  success: boolean;
  error?: string;
}
