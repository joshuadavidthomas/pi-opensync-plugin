import { basename } from "node:path";

/**
 * Internal session state tracked by the extension
 */
export class SessionState {
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

  constructor(
    sessionId: string,
    cwd: string,
    model?: { id: string; provider: string },
    parentExternalId?: string
  ) {
    this.externalId = sessionId;
    this.parentExternalId = parentExternalId;
    this.projectPath = cwd;
    this.projectName = basename(cwd);
    this.startedAt = Date.now();
    this.model = model?.id;
    this.provider = model?.provider;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.cost = 0;
    this.messageCount = 0;
    this.toolCallCount = 0;
  }

  /**
   * Update session state with usage from an assistant message
   */
  updateUsage(usage: { input: number; output: number; cost: { total: number } }): void {
    this.promptTokens += usage.input;
    this.completionTokens += usage.output;
    this.cost += usage.cost.total;
  }

  /**
   * Increment message count
   */
  incrementMessageCount(): void {
    this.messageCount++;
  }

  /**
   * Increment tool call count
   */
  incrementToolCallCount(count: number = 1): void {
    this.toolCallCount += count;
  }

  /**
   * Update model info
   */
  updateModel(model: { id: string; provider: string }): void {
    this.model = model.id;
    this.provider = model.provider;
  }

  /**
   * Generate a message ID for OpenSync
   */
  generateMessageId(role: string): string {
    return `${this.externalId}-${role}-${this.messageCount}`;
  }
}
