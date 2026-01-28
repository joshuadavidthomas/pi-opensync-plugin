import { describe, it, expect } from "bun:test";
import { SessionState } from "../src/state";

describe("SessionState", () => {
  it("creates initial state with correct values", () => {
    const state = new SessionState(
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
    const state = new SessionState(
      "fork-456",
      "/home/user/project",
      undefined,
      "parent-123"
    );
    
    expect(state.externalId).toBe("fork-456");
    expect(state.parentExternalId).toBe("parent-123");
  });
  
  it("works without model info", () => {
    const state = new SessionState("s1", "/path");
    
    expect(state.model).toBeUndefined();
    expect(state.provider).toBeUndefined();
  });

  it("updateUsage accumulates token usage and cost", () => {
    const state = new SessionState("s1", "/path");
    
    state.updateUsage({
      input: 100,
      output: 50,
      cost: { total: 0.001 },
    });
    
    expect(state.promptTokens).toBe(100);
    expect(state.completionTokens).toBe(50);
    expect(state.cost).toBe(0.001);
    
    state.updateUsage({
      input: 200,
      output: 100,
      cost: { total: 0.002 },
    });
    
    expect(state.promptTokens).toBe(300);
    expect(state.completionTokens).toBe(150);
    expect(state.cost).toBeCloseTo(0.003, 10);
  });

  it("incrementMessageCount increments message count by 1", () => {
    const state = new SessionState("s1", "/path");
    expect(state.messageCount).toBe(0);
    
    state.incrementMessageCount();
    expect(state.messageCount).toBe(1);
    
    state.incrementMessageCount();
    expect(state.messageCount).toBe(2);
  });

  it("incrementToolCallCount increments tool call count by specified amount", () => {
    const state = new SessionState("s1", "/path");
    expect(state.toolCallCount).toBe(0);
    
    state.incrementToolCallCount(3);
    expect(state.toolCallCount).toBe(3);
    
    state.incrementToolCallCount();
    expect(state.toolCallCount).toBe(4);
  });

  it("updateModel updates model and provider", () => {
    const state = new SessionState("s1", "/path");
    
    state.updateModel({ id: "gpt-4", provider: "openai" });
    
    expect(state.model).toBe("gpt-4");
    expect(state.provider).toBe("openai");
  });

  it("generateMessageId generates ID with session, role, and count", () => {
    const state = new SessionState("session-abc", "/path");
    state.messageCount = 5;
    
    const id = state.generateMessageId("user");
    expect(id).toBe("session-abc-user-5");
  });
});
