import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SyncClient } from "../src/client";
import type { SessionData, UserMessageData, AssistantMessageData } from "../src/client";
import type { Config } from "../src/config";

describe("SyncClient", () => {
  const mockConfig: Config = {
    convexUrl: "https://test.convex.site",
    apiKey: "osk_test123",
    autoSync: true,
    syncToolCalls: true,
    syncThinking: false,
    debug: false,
  };

  let client: SyncClient;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    client = new SyncClient(mockConfig);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("syncSession", () => {
    it("sends POST to /sync/session with transformed payload", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const session: SessionData = {
        sessionId: "test-123",
        projectPath: "/home/user/my-project",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        promptTokens: 100,
        completionTokens: 50,
        messageCount: 3,
      };

      await client.syncSession(session);

      expect(capturedBody.externalId).toBe("test-123");
      expect(capturedBody.source).toBe("pi");
      expect(capturedBody.projectPath).toBe("/home/user/my-project");
      expect(capturedBody.projectName).toBe("my-project");
      expect(capturedBody.title).toBe("Untitled");
      expect(capturedBody.model).toBe("claude-sonnet-4-5");
      expect(capturedBody.promptTokens).toBe(100);
      expect(capturedBody.completionTokens).toBe(50);
      expect(capturedBody.totalTokens).toBe(150);
    });

    it("includes title when provided", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      await client.syncSession({
        sessionId: "s1",
        projectPath: "/path",
        title: "My Session",
      });

      expect(capturedBody.title).toBe("My Session");
    });

    it("adds fork prefix when parentSessionId provided", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      await client.syncSession({
        sessionId: "fork-456",
        projectPath: "/path",
        parentSessionId: "parent-123-456-789",
        title: "My Session",
      });

      expect(capturedBody.title).toBe("[Fork::parent-1] My Session");
    });

    it("includes duration when isFinal is true", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      await client.syncSession({
        sessionId: "s1",
        projectPath: "/path",
        startedAt: Date.now() - 5000,
        isFinal: true,
      });

      expect(capturedBody.durationMs).toBeGreaterThanOrEqual(5000);
      expect(capturedBody.durationMs).toBeLessThan(6000);
    });

    it("returns success: true on 200 response", async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

      const result = await client.syncSession({ sessionId: "test", projectPath: "/path" });
      expect(result.success).toBe(true);
    });

    it("returns success: false on error response", async () => {
      globalThis.fetch = (async () =>
        new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

      const result = await client.syncSession({ sessionId: "test", projectPath: "/path" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });
  });

  describe("syncMessage with user message", () => {
    it("sends user message payload", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: UserMessageData = {
        role: "user",
        sessionId: "session-123",
        messageId: "msg-1",
        text: "Hello world",
        timestamp: 1706400000000,
      };

      await client.syncMessage(message);

      expect(capturedBody.sessionExternalId).toBe("session-123");
      expect(capturedBody.externalId).toBe("msg-1");
      expect(capturedBody.role).toBe("user");
      expect(capturedBody.textContent).toBe("Hello world");
      expect(capturedBody.createdAt).toBe(1706400000000);
    });
  });

  describe("syncMessage with assistant message", () => {
    it("sends assistant message payload with text", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
        usage: { input: 100, output: 50 },
      };

      await client.syncMessage(message);

      expect(capturedBody.sessionExternalId).toBe("session-123");
      expect(capturedBody.externalId).toBe("msg-2");
      expect(capturedBody.role).toBe("assistant");
      expect(capturedBody.textContent).toBe("Hello");
      expect(capturedBody.model).toBe("claude-sonnet-4-5");
      expect(capturedBody.promptTokens).toBe(100);
      expect(capturedBody.completionTokens).toBe(50);
      expect(capturedBody.parts).toBeUndefined();
    });

    it("includes tool call parts", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [
          { type: "text", text: "I'll read the file" },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "test.txt" } },
        ],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
      };

      await client.syncMessage(message);

      expect(capturedBody.textContent).toBe("I'll read the file");
      expect(capturedBody.parts).toHaveLength(2);
      expect(capturedBody.parts[0]).toEqual({ type: "text", content: "I'll read the file" });
      expect(capturedBody.parts[1]).toEqual({
        type: "tool-call",
        content: { toolName: "read", args: { path: "test.txt" } },
      });
    });

    it("includes tool results when provided", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [
          { type: "text", text: "Let me read that" },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "test.txt" } },
        ],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
        toolResults: [
          {
            toolName: "read",
            content: [{ type: "text", text: "file contents here" }],
          },
        ],
      };

      await client.syncMessage(message);

      expect(capturedBody.parts).toHaveLength(3);
      expect(capturedBody.parts[0].type).toBe("text");
      expect(capturedBody.parts[1].type).toBe("tool-call");
      expect(capturedBody.parts[2].type).toBe("tool-result");
      expect(capturedBody.parts[2].content).toBe("file contents here");
    });

    it("includes thinking when includeThinking is true", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [
          { type: "thinking", thinking: "Let me analyze..." },
          { type: "text", text: "The answer is 42" },
        ],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
        includeThinking: true,
      };

      await client.syncMessage(message);

      expect(capturedBody.textContent).toBe("<thinking>Let me analyze...</thinking>\nThe answer is 42");
      expect(capturedBody.parts).toHaveLength(2);
      expect(capturedBody.parts[0].type).toBe("text");
      expect(capturedBody.parts[1]).toEqual({ type: "thinking", content: "Let me analyze..." });
    });

    it("excludes thinking when includeThinking is false", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [
          { type: "thinking", thinking: "Let me analyze..." },
          { type: "text", text: "The answer is 42" },
        ],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
        includeThinking: false,
      };

      await client.syncMessage(message);

      expect(capturedBody.textContent).toBe("The answer is 42");
      expect(capturedBody.parts).toBeUndefined();
    });

    it("interleaves multiple tool calls with their results", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const message: AssistantMessageData = {
        role: "assistant",
        sessionId: "session-123",
        messageId: "msg-2",
        content: [
          { type: "text", text: "I'll read both files" },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "file1.txt" } },
          { type: "toolCall", id: "tc2", name: "read", arguments: { path: "file2.txt" } },
        ],
        model: "claude-sonnet-4-5",
        timestamp: 1706400000000,
        toolResults: [
          { toolName: "read", content: [{ type: "text", text: "contents of file1" }] },
          { toolName: "read", content: [{ type: "text", text: "contents of file2" }] },
        ],
      };

      await client.syncMessage(message);

      // Text + (tool call + result) * 2 = 5 parts
      expect(capturedBody.parts).toHaveLength(5);
      expect(capturedBody.parts[0].type).toBe("text");
      expect(capturedBody.parts[1].type).toBe("tool-call");
      expect(capturedBody.parts[2].type).toBe("tool-result");
      expect(capturedBody.parts[2].content).toBe("contents of file1");
      expect(capturedBody.parts[3].type).toBe("tool-call");
      expect(capturedBody.parts[4].type).toBe("tool-result");
      expect(capturedBody.parts[4].content).toBe("contents of file2");
    });
  });

  describe("syncBatch", () => {
    it("sends batch with transformed messages", async () => {
      let capturedBody: any = {};

      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      await client.syncBatch([
        { role: "user", sessionId: "s1", messageId: "m1", text: "Hello", timestamp: Date.now() },
        {
          role: "assistant",
          sessionId: "s1",
          messageId: "m2",
          content: [{ type: "text", text: "Hi there" }],
          model: "claude-sonnet-4-5",
          timestamp: Date.now(),
        },
      ]);

      expect(capturedBody.sessions).toEqual([]);
      expect(capturedBody.messages).toHaveLength(2);
      expect(capturedBody.messages[0].role).toBe("user");
      expect(capturedBody.messages[0].textContent).toBe("Hello");
      expect(capturedBody.messages[1].role).toBe("assistant");
      expect(capturedBody.messages[1].textContent).toBe("Hi there");
    });
  });

  describe("testConnection", () => {
    it("returns success: true when health check passes", async () => {
      globalThis.fetch = (async () =>
        new Response("OK", { status: 200 })) as unknown as typeof fetch;

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });

    it("returns success: false when health check fails", async () => {
      globalThis.fetch = (async () =>
        new Response("Error", { status: 500 })) as unknown as typeof fetch;

      const result = await client.testConnection();
      expect(result.success).toBe(false);
    });
  });
});

