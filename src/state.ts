import { basename } from "node:path";
import type { SessionState } from "./types.js";

/**
 * Create initial session state from pi context
 */
export function createSessionState(
  sessionId: string,
  cwd: string,
  model?: { id: string; provider: string },
  parentExternalId?: string
): SessionState {
  return {
    externalId: sessionId,
    parentExternalId,
    projectPath: cwd,
    projectName: basename(cwd),
    startedAt: Date.now(),
    model: model?.id,
    provider: model?.provider,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
}

/**
 * Update session state with usage from an assistant message
 */
export function updateSessionUsage(
  state: SessionState,
  usage: { input: number; output: number; cost: { total: number } }
): SessionState {
  return {
    ...state,
    promptTokens: state.promptTokens + usage.input,
    completionTokens: state.completionTokens + usage.output,
    cost: state.cost + usage.cost.total,
  };
}

/**
 * Increment message count
 */
export function incrementMessageCount(state: SessionState): SessionState {
  return {
    ...state,
    messageCount: state.messageCount + 1,
  };
}

/**
 * Increment tool call count
 */
export function incrementToolCallCount(state: SessionState, count: number = 1): SessionState {
  return {
    ...state,
    toolCallCount: state.toolCallCount + count,
  };
}

/**
 * Update model info
 */
export function updateModel(
  state: SessionState,
  model: { id: string; provider: string }
): SessionState {
  return {
    ...state,
    model: model.id,
    provider: model.provider,
  };
}

/**
 * Generate a message ID for OpenSync
 */
export function generateMessageId(sessionId: string, messageCount: number, role: string): string {
  return `${sessionId}-${role}-${messageCount}`;
}
