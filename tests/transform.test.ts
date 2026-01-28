import { describe, it, expect } from "bun:test";
import {
  generateSessionTitle,
  transformSession,
  extractUserMessageText,
  extractAssistantMessageText,
  countToolCalls,
  transformUserMessage,
  transformAssistantMessage,
} from "../src/transform";
import { SessionState } from "../src/state";

describe("generateSessionTitle", () => {
  it("returns 'Untitled' when no name and no parent", () => {
    const state = new SessionState("s1", "/path");
    expect(generateSessionTitle(state)).toBe("Untitled");
  });
  
  it("returns session name when no parent", () => {
    const state = new SessionState("s1", "/path");
    expect(generateSessionTitle(state, "My Session")).toBe("My Session");
  });
  
  it("adds fork prefix when parent exists", () => {
    const state = new SessionState("s1", "/path", undefined, "parent-123-456-789");
    expect(generateSessionTitle(state, "My Session")).toBe("[Fork::parent-1] My Session");
  });
  
  it("adds 'Untitled' with fork prefix when no name but has parent", () => {
    const state = new SessionState("s1", "/path", undefined, "abcd1234-5678");
    expect(generateSessionTitle(state)).toBe("[Fork::abcd1234] Untitled");
  });
});

describe("transformSession", () => {
  it("transforms session state to payload", () => {
    const state = new SessionState(
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
    const state = new SessionState("s1", "/path");
    // Manually set startedAt to control duration
    (state as any).startedAt = Date.now() - 5000;
    
    const payload = transformSession(state, undefined, true);
    
    expect(payload.durationMs).toBeGreaterThanOrEqual(5000);
    expect(payload.durationMs).toBeLessThan(6000);
  });
  
  it("omits zero values", () => {
    const state = new SessionState("s1", "/path");
    const payload = transformSession(state);
    
    expect(payload.promptTokens).toBeUndefined();
    expect(payload.completionTokens).toBeUndefined();
    expect(payload.cost).toBeUndefined();
    expect(payload.messageCount).toBeUndefined();
  });
  
  it("includes non-zero usage stats", () => {
    const state = new SessionState("s1", "/path");
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
    expect(payload.parts).toBeUndefined();
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
  
  it("includes tool call parts when message has tool calls", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "I'll read the file" },
        { type: "toolCall" as const, id: "tc1", name: "read", arguments: { path: "test.txt" } },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message);
    
    expect(payload.textContent).toBe("I'll read the file");
    // Text + tool call = 2 parts (workaround for OpenSync UI)
    expect(payload.parts).toHaveLength(2);
    expect(payload.parts![0]).toEqual({
      type: "text",
      content: "I'll read the file",
    });
    expect(payload.parts![1]).toEqual({
      type: "tool-call",
      content: {
        toolName: "read",
        args: { path: "test.txt" },
      },
    });
  });
  
  it("includes thinking parts when includeThinking is true", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "Let me analyze..." },
        { type: "text" as const, text: "The answer is 42" },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message, true);
    
    expect(payload.textContent).toBe("<thinking>Let me analyze...</thinking>\nThe answer is 42");
    // Text + thinking = 2 parts (workaround for OpenSync UI)
    expect(payload.parts).toHaveLength(2);
    expect(payload.parts![0]).toEqual({
      type: "text",
      content: "<thinking>Let me analyze...</thinking>\nThe answer is 42",
    });
    expect(payload.parts![1]).toEqual({
      type: "thinking",
      content: "Let me analyze...",
    });
  });
  
  it("excludes thinking parts when includeThinking is false", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "Let me analyze..." },
        { type: "text" as const, text: "The answer is 42" },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message, false);
    
    expect(payload.textContent).toBe("The answer is 42");
    expect(payload.parts).toBeUndefined();
  });
  
  it("combines tool call and thinking parts", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "I should read this file" },
        { type: "text" as const, text: "Let me check that" },
        { type: "toolCall" as const, id: "tc1", name: "read", arguments: { path: "test.txt" } },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const payload = transformAssistantMessage("session-123", "msg-2", message, true);
    
    // Text + tool call + thinking = 3 parts (workaround for OpenSync UI)
    expect(payload.parts).toHaveLength(3);
    expect(payload.parts![0].type).toBe("text");
    expect(payload.parts![1].type).toBe("tool-call");
    expect(payload.parts![2].type).toBe("thinking");
  });
  
  it("includes tool results when provided", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Let me read that file" },
        { type: "toolCall" as const, id: "tc1", name: "read", arguments: { path: "test.txt" } },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const toolResults = [
      {
        role: "toolResult" as const,
        toolName: "read",
        content: [{ type: "text" as const, text: "file contents here" }],
      },
    ];
    
    const payload = transformAssistantMessage("session-123", "msg-2", message, false, toolResults);
    
    // Text + tool call + tool result = 3 parts
    expect(payload.parts).toHaveLength(3);
    expect(payload.parts![0].type).toBe("text");
    expect(payload.parts![1].type).toBe("tool-call");
    expect(payload.parts![2].type).toBe("tool-result");
    expect(payload.parts![2].content).toBe("file contents here");
  });
  
  it("interleaves multiple tool calls with their results", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "I'll read both files" },
        { type: "toolCall" as const, id: "tc1", name: "read", arguments: { path: "file1.txt" } },
        { type: "toolCall" as const, id: "tc2", name: "read", arguments: { path: "file2.txt" } },
        { type: "toolCall" as const, id: "tc3", name: "bash", arguments: { command: "ls" } },
      ],
      model: "claude-sonnet-4-5",
      timestamp: 1706400000000,
    };
    
    const toolResults = [
      {
        role: "toolResult" as const,
        toolName: "read",
        content: [{ type: "text" as const, text: "contents of file1" }],
      },
      {
        role: "toolResult" as const,
        toolName: "read",
        content: [{ type: "text" as const, text: "contents of file2" }],
      },
      {
        role: "toolResult" as const,
        toolName: "bash",
        content: [{ type: "text" as const, text: "file1.txt\nfile2.txt" }],
      },
    ];
    
    const payload = transformAssistantMessage("session-123", "msg-2", message, false, toolResults);
    
    // Text + (tool call + result) * 3 = 7 parts
    expect(payload.parts).toHaveLength(7);
    expect(payload.parts![0].type).toBe("text");
    expect(payload.parts![1].type).toBe("tool-call");
    expect((payload.parts![1].content as any).toolName).toBe("read");
    expect(payload.parts![2].type).toBe("tool-result");
    expect(payload.parts![2].content).toBe("contents of file1");
    expect(payload.parts![3].type).toBe("tool-call");
    expect((payload.parts![3].content as any).toolName).toBe("read");
    expect(payload.parts![4].type).toBe("tool-result");
    expect(payload.parts![4].content).toBe("contents of file2");
    expect(payload.parts![5].type).toBe("tool-call");
    expect((payload.parts![5].content as any).toolName).toBe("bash");
    expect(payload.parts![6].type).toBe("tool-result");
    expect(payload.parts![6].content).toBe("file1.txt\nfile2.txt");
  });
});


