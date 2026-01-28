import type { SessionState, SessionPayload, MessagePayload } from "./types.js";

// Type definitions for pi message content
// These match the actual pi-ai types but are defined here to avoid import issues in tests
interface TextContent {
  type: "text";
  text: string;
}

interface ThinkingContent {
  type: "thinking";
  text: string;
}

interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface ImageContent {
  type: "image";
  source: { type: "base64"; mediaType: string; data: string };
}

type AssistantContentPart = TextContent | ThinkingContent | ToolCallContent;
type UserContentPart = TextContent | ImageContent;

interface AssistantMessageLike {
  role: "assistant";
  content: AssistantContentPart[];
  model: string;
  timestamp: number;
  usage?: {
    input: number;
    output: number;
  };
}

interface ToolResultMessageLike {
  role: "toolResult";
  toolName: string;
  content: Array<{ type: string; text?: string }>;
}

/**
 * Generate session title, including fork prefix if applicable
 */
export function generateSessionTitle(
  state: SessionState,
  sessionName?: string
): string | undefined {
  let title = sessionName;
  
  if (state.parentExternalId) {
    const prefix = `[Fork::${state.parentExternalId.slice(0, 8)}]`;
    title = title ? `${prefix} ${title}` : prefix;
  }
  
  return title;
}

/**
 * Transform session state to OpenSync payload
 */
export function transformSession(
  state: SessionState,
  sessionName?: string,
  isFinal: boolean = false
): SessionPayload {
  const payload: SessionPayload = {
    externalId: state.externalId,
    source: "pi",
    projectPath: state.projectPath,
    projectName: state.projectName,
  };
  
  const title = generateSessionTitle(state, sessionName);
  if (title) {
    payload.title = title;
  }
  
  if (state.model) {
    payload.model = state.model;
  }
  if (state.provider) {
    payload.provider = state.provider;
  }
  
  // Include usage stats
  if (state.promptTokens > 0 || state.completionTokens > 0) {
    payload.promptTokens = state.promptTokens;
    payload.completionTokens = state.completionTokens;
    payload.totalTokens = state.promptTokens + state.completionTokens;
  }
  
  if (state.cost > 0) {
    payload.cost = state.cost;
  }
  
  if (state.messageCount > 0) {
    payload.messageCount = state.messageCount;
  }
  
  // Include duration on final sync
  if (isFinal) {
    payload.durationMs = Date.now() - state.startedAt;
  }
  
  return payload;
}

/**
 * Extract text content from a user message
 */
export function extractUserMessageText(content: string | UserContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }
  
  // Content is array of text/image parts
  const textParts = content
    .filter((part): part is TextContent => part.type === "text")
    .map(part => part.text);
  
  return textParts.join("\n");
}

/**
 * Extract text content from an assistant message
 */
export function extractAssistantMessageText(
  content: AssistantContentPart[],
  includeThinking: boolean = false
): string {
  const parts: string[] = [];
  
  for (const part of content) {
    if (part.type === "text") {
      parts.push(part.text);
    } else if (part.type === "thinking" && includeThinking) {
      parts.push(`<thinking>${part.text}</thinking>`);
    }
    // Skip toolCall parts - those are tracked separately
  }
  
  return parts.join("\n");
}

/**
 * Count tool calls in an assistant message
 */
export function countToolCalls(content: AssistantContentPart[]): number {
  return content.filter(part => part.type === "toolCall").length;
}

/**
 * Transform a user input to OpenSync message payload
 */
export function transformUserMessage(
  sessionId: string,
  messageId: string,
  text: string,
  timestamp: number = Date.now()
): MessagePayload {
  return {
    sessionExternalId: sessionId,
    externalId: messageId,
    role: "user",
    textContent: text,
    createdAt: timestamp,
  };
}

/**
 * Transform an assistant message to OpenSync message payload
 */
export function transformAssistantMessage(
  sessionId: string,
  messageId: string,
  message: AssistantMessageLike,
  includeThinking: boolean = false
): MessagePayload {
  const textContent = extractAssistantMessageText(message.content, includeThinking);
  
  const payload: MessagePayload = {
    sessionExternalId: sessionId,
    externalId: messageId,
    role: "assistant",
    textContent: textContent || undefined,
    model: message.model,
    createdAt: message.timestamp,
  };
  
  if (message.usage) {
    payload.promptTokens = message.usage.input;
    payload.completionTokens = message.usage.output;
  }
  
  return payload;
}

/**
 * Transform a tool result to OpenSync message payload (when syncToolCalls is enabled)
 */
export function transformToolResultMessage(
  sessionId: string,
  messageId: string,
  toolResult: ToolResultMessageLike,
  timestamp: number = Date.now()
): MessagePayload {
  // Extract text from tool result content
  const textParts = toolResult.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map(part => part.text);
  
  return {
    sessionExternalId: sessionId,
    externalId: messageId,
    role: "tool",
    textContent: `[${toolResult.toolName}]\n${textParts.join("\n")}`,
    createdAt: timestamp,
  };
}
