import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SyncClient } from "../src/client";
import { Config } from "../src/config";
import type { SessionPayload, MessagePayload } from "../src/types";

describe("SyncClient", () => {
  const mockConfig = new Config({
    convexUrl: "https://test.convex.site",
    apiKey: "osk_test123",
    debug: false,
  });
  
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
    it("sends POST to /sync/session with correct headers", async () => {
      let capturedUrl: string = "";
      let capturedOptions: RequestInit = {};
      
      globalThis.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
        capturedUrl = url.toString();
        capturedOptions = options || {};
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;
      
      const session: SessionPayload = {
        externalId: "test-123",
        source: "pi",
        projectPath: "/home/user/project",
      };
      
      await client.syncSession(session);
      
      expect(capturedUrl).toBe("https://test.convex.site/sync/session");
      expect(capturedOptions.method).toBe("POST");
      expect(capturedOptions.headers).toEqual({
        "Content-Type": "application/json",
        "Authorization": "Bearer osk_test123",
      });
      expect(JSON.parse(capturedOptions.body as string)).toEqual(session);
    });
    
    it("returns success: true on 200 response", async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(true);
    });
    
    it("returns success: false on error response", async () => {
      globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });
    
    it("returns success: false on network error", async () => {
      globalThis.fetch = (async () => { throw new Error("Network error"); }) as unknown as typeof fetch;
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });
  
  describe("syncMessage", () => {
    it("sends POST to /sync/message", async () => {
      let capturedUrl: string = "";
      
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;
      
      const message: MessagePayload = {
        sessionExternalId: "session-123",
        externalId: "msg-1",
        role: "user",
        textContent: "Hello",
      };
      
      await client.syncMessage(message);
      
      expect(capturedUrl).toBe("https://test.convex.site/sync/message");
    });
  });
  
  describe("syncBatch", () => {
    it("sends POST to /sync/batch with sessions and messages", async () => {
      let capturedBody: string = "";
      
      globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;
      
      const sessions: SessionPayload[] = [{ externalId: "s1", source: "pi" }];
      const messages: MessagePayload[] = [{ sessionExternalId: "s1", externalId: "m1", role: "user" }];
      
      await client.syncBatch(sessions, messages);
      
      expect(JSON.parse(capturedBody)).toEqual({ sessions, messages });
    });
  });
  
  describe("testConnection", () => {
    it("returns success: true when health check passes", async () => {
      globalThis.fetch = (async () => new Response("OK", { status: 200 })) as unknown as typeof fetch;
      
      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });
    
    it("returns success: false when health check fails", async () => {
      globalThis.fetch = (async () => new Response("Error", { status: 500 })) as unknown as typeof fetch;
      
      const result = await client.testConnection();
      expect(result.success).toBe(false);
    });
  });
});
