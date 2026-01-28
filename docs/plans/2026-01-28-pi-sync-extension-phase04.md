# Phase 4: State Management & Data Transformation

## Overview
Implement session state tracking and data transformation from pi events to OpenSync payloads.

## Changes Required:

### 1. State Module
**File**: `src/state.ts`

```typescript
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
```

### 2. Transform Module
**File**: `src/transform.ts`

```typescript
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
```

### 3. State Tests
**File**: `tests/state.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import {
  createSessionState,
  updateSessionUsage,
  incrementMessageCount,
  incrementToolCallCount,
  generateMessageId,
  updateModel,
} from "../src/state.js";

describe("createSessionState", () => {
  it("creates initial state with correct values", () => {
    const state = createSessionState(
      "session-123",
      "/home/user/my-project",
      { id: "claude-sonnet-4-5", provider: "anthropic" }
    );
    
    expect(state.externalId).toBe("session-123");
    expect(state.projectPath).toBe("/home/user/my-project");
    expect(state.projectName).toBe("my-project");
    expect(state.model).toBe("claude-sonnet-4-5");
    expect(state.provider).toBe("anthropic");
    expect(state.promptTokens).toBe(0);
    expect(state.completionTokens).toBe(0);
    expect(state.cost).toBe(0);
    expect(state.messageCount).toBe(0);
    expect(state.toolCallCount).toBe(0);
    expect(state.parentExternalId).toBeUndefined();
  });
  
  it("includes parentExternalId when provided", () => {
    const state = createSessionState(
      "fork-456",
      "/home/user/project",
      undefined,
      "parent-123"
    );
    
    expect(state.externalId).toBe("fork-456");
    expect(state.parentExternalId).toBe("parent-123");
  });
  
  it("works without model info", () => {
    const state = createSessionState("s1", "/path");
    
    expect(state.model).toBeUndefined();
    expect(state.provider).toBeUndefined();
  });
});

describe("updateSessionUsage", () => {
  it("accumulates token usage and cost", () => {
    let state = createSessionState("s1", "/path");
    
    state = updateSessionUsage(state, {
      input: 100,
      output: 50,
      cost: { total: 0.001 },
    });
    
    expect(state.promptTokens).toBe(100);
    expect(state.completionTokens).toBe(50);
    expect(state.cost).toBe(0.001);
    
    state = updateSessionUsage(state, {
      input: 200,
      output: 100,
      cost: { total: 0.002 },
    });
    
    expect(state.promptTokens).toBe(300);
    expect(state.completionTokens).toBe(150);
    expect(state.cost).toBeCloseTo(0.003, 10);
  });
});

describe("incrementMessageCount", () => {
  it("increments message count by 1", () => {
    let state = createSessionState("s1", "/path");
    expect(state.messageCount).toBe(0);
    
    state = incrementMessageCount(state);
    expect(state.messageCount).toBe(1);
    
    state = incrementMessageCount(state);
    expect(state.messageCount).toBe(2);
  });
});

describe("incrementToolCallCount", () => {
  it("increments tool call count by specified amount", () => {
    let state = createSessionState("s1", "/path");
    expect(state.toolCallCount).toBe(0);
    
    state = incrementToolCallCount(state, 3);
    expect(state.toolCallCount).toBe(3);
    
    state = incrementToolCallCount(state);
    expect(state.toolCallCount).toBe(4);
  });
});

describe("updateModel", () => {
  it("updates model and provider", () => {
    let state = createSessionState("s1", "/path");
    
    state = updateModel(state, { id: "gpt-4", provider: "openai" });
    
    expect(state.model).toBe("gpt-4");
    expect(state.provider).toBe("openai");
  });
});

describe("generateMessageId", () => {
  it("generates ID with session, role, and count", () => {
    const id = generateMessageId("session-abc", 5, "user");
    expect(id).toBe("session-abc-user-5");
  });
});
```

### 4. Transform Tests
**File**: `tests/transform.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import {
  generateSessionTitle,
  transformSession,
  extractUserMessageText,
  extractAssistantMessageText,
  countToolCalls,
  transformUserMessage,
  transformAssistantMessage,
  transformToolResultMessage,
} from "../src/transform.js";
import { createSessionState } from "../src/state.js";

describe("generateSessionTitle", () => {
  it("returns undefined when no name and no parent", () => {
    const state = createSessionState("s1", "/path");
    expect(generateSessionTitle(state)).toBeUndefined();
  });
  
  it("returns session name when no parent", () => {
    const state = createSessionState("s1", "/path");
    expect(generateSessionTitle(state, "My Session")).toBe("My Session");
  });
  
  it("adds fork prefix when parent exists", () => {
    const state = createSessionState("s1", "/path", undefined, "parent-123-456-789");
    expect(generateSessionTitle(state, "My Session")).toBe("[Fork::parent-1] My Session");
  });
  
  it("returns just fork prefix when no name but has parent", () => {
    const state = createSessionState("s1", "/path", undefined, "abcd1234-5678");
    expect(generateSessionTitle(state)).toBe("[Fork::abcd1234]");
  });
});

describe("transformSession", () => {
  it("transforms session state to payload", () => {
    const state = createSessionState(
      "session-123",
      "/home/user/project",
      { id: "claude-sonnet-4-5", provider: "anthropic" }
    );
    
    const payload = transformSession(state, "Test Session");
    
    expect(payload.externalId).toBe("session-123");
    expect(payload.source).toBe("pi");
    expect(payload.projectPath).toBe("/home/user/project");
    expect(payload.projectName).toBe("project");
    expect(payload.title).toBe("Test Session");
    expect(payload.model).toBe("claude-sonnet-4-5");
    expect(payload.provider).toBe("anthropic");
  });
  
  it("includes duration on final sync", () => {
    const state = createSessionState("s1", "/path");
    // Manually set startedAt to control duration
    (state as any).startedAt = Date.now() - 5000;
    
    const payload = transformSession(state, undefined, true);
    
    expect(payload.durationMs).toBeGreaterThanOrEqual(5000);
    expect(payload.durationMs).toBeLessThan(6000);
  });
  
  it("omits zero values", () => {
    const state = createSessionState("s1", "/path");
    const payload = transformSession(state);
    
    expect(payload.promptTokens).toBeUndefined();
    expect(payload.completionTokens).toBeUndefined();
    expect(payload.cost).toBeUndefined();
    expect(payload.messageCount).toBeUndefined();
  });
  
  it("includes non-zero usage stats", () => {
    const state = createSessionState("s1", "/path");
    state.promptTokens = 100;
    state.completionTokens = 50;
    state.cost = 0.005;
    state.messageCount = 3;
    
    const payload = transformSession(state);
    
    expect(payload.promptTokens).toBe(100);
    expect(payload.completionTokens).toBe(50);
    expect(payload.totalTokens).toBe(150);
    expect(payload.cost).toBe(0.005);
    expect(payload.messageCount).toBe(3);
  });
});

describe("extractUserMessageText", () => {
  it("handles string content", () => {
    expect(extractUserMessageText("Hello world")).toBe("Hello world");
  });
  
  it("extracts text from content array", () => {
    const content = [
      { type: "text" as const, text: "First" },
      { type: "image" as const, source: { type: "base64" as const, mediaType: "image/png", data: "..." } },
      { type: "text" as const, text: "Second" },
    ];
    
    expect(extractUserMessageText(content)).toBe("First\nSecond");
  });
  
  it("handles empty array", () => {
    expect(extractUserMessageText([])).toBe("");
  });
});

describe("extractAssistantMessageText", () => {
  it("extracts text parts", () => {
    const content = [
      { type: "text" as const, text: "Hello" },
      { type: "text" as const, text: "World" },
    ];
    
    expect(extractAssistantMessageText(content)).toBe("Hello\nWorld");
  });
  
  it("excludes thinking by default", () => {
    const content = [
      { type: "thinking" as const, text: "Let me think..." },
      { type: "text" as const, text: "The answer is 42" },
    ];
    
    expect(extractAssistantMessageText(content)).toBe("The answer is 42");
  });
  
  it("includes thinking when requested", () => {
    const content = [
      { type: "thinking" as const, text: "Let me think..." },
      { type: "text" as const, text: "The answer is 42" },
    ];
    
    expect(extractAssistantMessageText(content, true)).toBe(
      "<thinking>Let me think...</thinking>\nThe answer is 42"
    );
  });
  
  it("skips tool calls", () => {
    const content = [
      { type: "text" as const, text: "I will read the file" },
      { type: "toolCall" as const, toolCallId: "tc1", toolName: "read", input: { path: "foo.txt" } },
      { type: "text" as const, text: "Done" },
    ];
    
    expect(extractAssistantMessageText(content)).toBe("I will read the file\nDone");
  });
});

describe("countToolCalls", () => {
  it("counts tool calls in content", () => {
    const content = [
      { type: "text" as const, text: "Working..." },
      { type: "toolCall" as const, toolCallId: "tc1", toolName: "read", input: {} },
      { type: "toolCall" as const, toolCallId: "tc2", toolName: "write", input: {} },
    ];
    
    expect(countToolCalls(content)).toBe(2);
  });
  
  it("returns 0 when no tool calls", () => {
    const content = [{ type: "text" as const, text: "Hello" }];
    expect(countToolCalls(content)).toBe(0);
  });
});

describe("transformUserMessage", () => {
  it("creates user message payload", () => {
    const payload = transformUserMessage(
      "session-123",
      "msg-1",
      "Hello world",
      1706400000000
    );
    
    expect(payload.sessionExternalId).toBe("session-123");
    expect(payload.externalId).toBe("msg-1");
    expect(payload.role).toBe("user");
    expect(payload.textContent).toBe("Hello world");
    expect(payload.createdAt).toBe(1706400000000);
  });
});

describe("transformAssistantMessage", () => {
  it("creates assistant message payload", () => {
    const message = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello" }],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
      usage: {
        input: 100,
        output: 50,
      },
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message);
    
    expect(payload.sessionExternalId).toBe("session-123");
    expect(payload.externalId).toBe("msg-2");
    expect(payload.role).toBe("assistant");
    expect(payload.textContent).toBe("Hello");
    expect(payload.model).toBe("claude-sonnet-4-5");
    expect(payload.promptTokens).toBe(100);
    expect(payload.completionTokens).toBe(50);
  });
  
  it("handles message without usage", () => {
    const message = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello" }],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message);
    
    expect(payload.promptTokens).toBeUndefined();
    expect(payload.completionTokens).toBeUndefined();
  });
});

describe("transformToolResultMessage", () => {
  it("creates tool result message payload", () => {
    const toolResult = {
      role: "toolResult" as const,
      toolName: "read",
      content: [{ type: "text", text: "file contents here" }],
    };
    
    const payload = transformToolResultMessage(
      "session-123",
      "msg-3",
      toolResult,
      1706400000000
    );
    
    expect(payload.sessionExternalId).toBe("session-123");
    expect(payload.externalId).toBe("msg-3");
    expect(payload.role).toBe("tool");
    expect(payload.textContent).toBe("[read]\nfile contents here");
    expect(payload.createdAt).toBe(1706400000000);
  });
});
```

## Success Criteria:

### Automated Verification:
- [ ] `bun test tests/state.test.ts` passes
- [ ] `bun test tests/transform.test.ts` passes
- [ ] `bun run typecheck` passes

### Manual Verification:
- [ ] N/A (no manual verification needed for this phase)

### Commit Checkpoint:
After all verifications pass, commit with message:
```
Add state management and data transformation
```
