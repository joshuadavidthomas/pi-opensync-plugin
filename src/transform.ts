import type { SessionState, SessionPayload, MessagePayload, MessagePart } from "./types.js";

// Minimal type definitions for message content
// These capture only what we need for transformation, avoiding full pi-ai type complexity in tests
// Real pi-ai objects satisfy these interfaces via structural typing

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

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

type UserContentPart = TextContent | ImageContent;
type AssistantContentPart = TextContent | ThinkingContent | ToolCallContent;

// Minimal message-like interfaces for what we actually use
export interface AssistantMessageLike {
  role: "assistant";
  content: AssistantContentPart[];
  model: string;
  timestamp: number;
  usage?: {
    input: number;
    output: number;
  };
}

export interface ToolResultMessageLike {
  role: "toolResult";
  toolName: string;
  content: (TextContent | ImageContent)[];
}

/**
 * Generate session title, including fork prefix if applicable
 */
export function generateSessionTitle(
  state: SessionState,
  sessionName?: string
): string | undefined {
  // Use provided name, or "Untitled" as fallback (matching pi's default)
  let title = sessionName || "Untitled";
  
  if (state.parentExternalId) {
    const prefix = `[Fork::${state.parentExternalId.slice(0, 8)}]`;
    title = `${prefix} ${title}`;
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
      // ThinkingContent has 'thinking' property
      parts.push(`<thinking>${part.thinking}</thinking>`);
    }
    // Skip toolCall parts - those are tracked separately
  }
  
  return parts.join("\n");
}

/**
 * Count tool calls in an assistant message
 */
export function countToolCalls(content: AssistantContentPart[]): number {
  return content.filter((part): part is ToolCallContent => part.type === "toolCall").length;
}

/**
 * Extract tool results as structured parts for OpenSync
 */
export function extractToolResultParts(toolResult: ToolResultMessageLike): MessagePart[] {
  // Extract text from tool result content (skip images)
  const textParts = toolResult.content
    .filter((part): part is TextContent => part.type === "text")
    .map(part => part.text);
  
  const resultText = textParts.join("\n");
  
  return [{
    type: "tool-result",
    content: resultText,
  }];
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
  includeThinking: boolean = false,
  toolResults: ToolResultMessageLike[] = []
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
  
  // Add structured parts for tool calls, tool results, and thinking
  const parts: MessagePart[] = [];
  
  // Check what types of content we have
  const hasToolCalls = message.content.some(part => part.type === "toolCall");
  const hasThinking = includeThinking && message.content.some(part => part.type === "thinking");
  const hasToolResults = toolResults.length > 0;
  
  // If there's text content AND we have tool calls/thinking/results, add text as a part first
  // This works around OpenSync UI limitation where it only renders parts OR textContent, not both
  if (textContent && (hasToolCalls || hasThinking || hasToolResults)) {
    parts.push({
      type: "text",
      content: textContent,
    });
  }
  
  // First pass: interleave tool calls with their results in the order they appear
  // Tool calls and results are in the same order (tool call 1 -> result 1, tool call 2 -> result 2, etc.)
  let resultIndex = 0;
  for (const part of message.content) {
    if (part.type === "toolCall") {
      // Add the tool call
      parts.push({
        type: "tool-call",
        content: {
          toolName: part.name,
          args: part.arguments,
        },
      });
      
      // Add the corresponding tool result if it exists
      if (resultIndex < toolResults.length) {
        const result = toolResults[resultIndex];
        const resultParts = extractToolResultParts(result);
        parts.push(...resultParts);
        resultIndex++;
      }
    }
  }
  
  // Second pass: add thinking blocks (after tool calls/results)
  if (includeThinking) {
    for (const part of message.content) {
      if (part.type === "thinking") {
        parts.push({
          type: "thinking",
          content: part.thinking,
        });
      }
    }
  }
  
  if (parts.length > 0) {
    payload.parts = parts;
  }
  
  return payload;
}


