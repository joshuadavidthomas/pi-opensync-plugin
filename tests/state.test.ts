import { describe, it, expect } from "bun:test";
import {
  createSessionState,
  updateSessionUsage,
  incrementMessageCount,
  incrementToolCallCount,
  generateMessageId,
  updateModel,
} from "../src/state";

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
