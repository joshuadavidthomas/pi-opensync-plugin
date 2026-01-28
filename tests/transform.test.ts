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
      { type: "image" as const, data: "base64data", mimeType: "image/png" },
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
      { type: "thinking" as const, thinking: "Let me think..." },
      { type: "text" as const, text: "The answer is 42" },
    ];
    
    expect(extractAssistantMessageText(content)).toBe("The answer is 42");
  });
  
  it("includes thinking when requested", () => {
    const content = [
      { type: "thinking" as const, thinking: "Let me think..." },
      { type: "text" as const, text: "The answer is 42" },
    ];
    
    expect(extractAssistantMessageText(content, true)).toBe(
      "<thinking>Let me think...</thinking>\nThe answer is 42"
    );
  });
  
  it("skips tool calls", () => {
    const content = [
      { type: "text" as const, text: "I will read the file" },
      { type: "toolCall" as const, id: "tc1", name: "read", arguments: { path: "foo.txt" } },
      { type: "text" as const, text: "Done" },
    ];
    
    expect(extractAssistantMessageText(content)).toBe("I will read the file\nDone");
  });
});

describe("countToolCalls", () => {
  it("counts tool calls in content", () => {
    const content = [
      { type: "text" as const, text: "Working..." },
      { type: "toolCall" as const, id: "tc1", name: "read", arguments: {} },
      { type: "toolCall" as const, id: "tc2", name: "write", arguments: {} },
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
      content: [{ type: "text" as const, text: "file contents here" }],
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
