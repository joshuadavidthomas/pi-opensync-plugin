# Phase 3: OpenSync API Client

## Overview
Implement the HTTP client for communicating with OpenSync API endpoints.

## Changes Required:

### 1. Client Module
**File**: `src/client.ts`

```typescript
import type { Config, SessionPayload, MessagePayload, SyncResult } from "./types.js";

export class SyncClient {
  private siteUrl: string;
  private apiKey: string;
  private debug: boolean;
  
  constructor(config: Config) {
    this.siteUrl = config.convexUrl; // Already normalized
    this.apiKey = config.apiKey;
    this.debug = config.debug ?? false;
  }
  
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[pi-opensync]", ...args);
    }
  }
  
  private async request<T>(endpoint: string, data: unknown): Promise<SyncResult & { data?: T }> {
    const url = `${this.siteUrl}${endpoint}`;
    
    this.log(`POST ${endpoint}`, data);
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const text = await response.text();
        this.log(`Error ${response.status}:`, text);
        return { success: false, error: `${response.status}: ${text}` };
      }
      
      const result = await response.json() as T;
      this.log("Response:", result);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("Request failed:", message);
      return { success: false, error: message };
    }
  }
  
  /**
   * Sync a session to OpenSync
   */
  async syncSession(session: SessionPayload): Promise<SyncResult> {
    return this.request("/sync/session", session);
  }
  
  /**
   * Sync a message to OpenSync
   */
  async syncMessage(message: MessagePayload): Promise<SyncResult> {
    return this.request("/sync/message", message);
  }
  
  /**
   * Batch sync sessions and messages
   */
  async syncBatch(sessions: SessionPayload[], messages: MessagePayload[]): Promise<SyncResult> {
    return this.request("/sync/batch", { sessions, messages });
  }
  
  /**
   * Test connection to OpenSync
   */
  async testConnection(): Promise<SyncResult> {
    try {
      const response = await fetch(`${this.siteUrl}/health`);
      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: `Health check failed: ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}
```

### 2. Update Extension with Client
**File**: `src/index.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, getConfigPath } from "./config.js";
import { SyncClient } from "./client.js";
import type { Config } from "./types.js";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();
  
  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null, null);
    return;
  }
  
  if (config.autoSync === false) {
    if (config.debug) {
      console.log("[pi-opensync] Auto-sync disabled in config");
    }
    registerConfigCommand(pi, config, null);
    return;
  }
  
  const client = new SyncClient(config);
  
  if (config.debug) {
    console.log("[pi-opensync] Extension loaded, client initialized");
  }
  
  // Register config command with client for connection testing
  registerConfigCommand(pi, config, client);
  
  // Event handlers will be added in Phase 5
}

function registerConfigCommand(pi: ExtensionAPI, config: Config | null, client: SyncClient | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      
      if (config && client) {
        const action = await ctx.ui.select("OpenSync Configuration", [
          "View current config",
          "Test connection",
          "Show config file path",
        ]);
        
        if (!action) return;
        
        switch (action) {
          case "View current config": {
            ctx.ui.notify(
              `Convex URL: ${config.convexUrl}\n` +
              `API Key: ${config.apiKey.slice(0, 8)}...\n` +
              `Auto Sync: ${config.autoSync !== false}\n` +
              `Sync Tool Calls: ${config.syncToolCalls ?? false}\n` +
              `Sync Thinking: ${config.syncThinking ?? false}\n` +
              `Debug: ${config.debug ?? false}`,
              "info"
            );
            break;
          }
          case "Test connection": {
            ctx.ui.notify("Testing connection...", "info");
            const result = await client.testConnection();
            if (result.success) {
              ctx.ui.notify("Connection successful!", "info");
            } else {
              ctx.ui.notify(`Connection failed: ${result.error}`, "error");
            }
            break;
          }
          case "Show config file path": {
            ctx.ui.notify(`Config file: ${getConfigPath()}`, "info");
            break;
          }
        }
      } else {
        ctx.ui.notify(
          `No config found.\n\nCreate config at:\n${getConfigPath()}\n\nOr set environment variables:\nPI_OPENSYNC_CONVEX_URL\nPI_OPENSYNC_API_KEY`,
          "info"
        );
      }
    },
  });
}
```

### 3. Client Tests
**File**: `tests/client.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SyncClient } from "../src/client.js";
import type { Config, SessionPayload, MessagePayload } from "../src/types.js";

describe("SyncClient", () => {
  const mockConfig: Config = {
    convexUrl: "https://test.convex.site",
    apiKey: "osk_test123",
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
    it("sends POST to /sync/session with correct headers", async () => {
      let capturedUrl: string = "";
      let capturedOptions: RequestInit = {};
      
      globalThis.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
        capturedUrl = url.toString();
        capturedOptions = options || {};
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      
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
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(true);
    });
    
    it("returns success: false on error response", async () => {
      globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });
    
    it("returns success: false on network error", async () => {
      globalThis.fetch = async () => { throw new Error("Network error"); };
      
      const result = await client.syncSession({ externalId: "test", source: "pi" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });
  
  describe("syncMessage", () => {
    it("sends POST to /sync/message", async () => {
      let capturedUrl: string = "";
      
      globalThis.fetch = async (url: RequestInfo | URL) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      
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
      
      globalThis.fetch = async (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      
      const sessions: SessionPayload[] = [{ externalId: "s1", source: "pi" }];
      const messages: MessagePayload[] = [{ sessionExternalId: "s1", externalId: "m1", role: "user" }];
      
      await client.syncBatch(sessions, messages);
      
      expect(JSON.parse(capturedBody)).toEqual({ sessions, messages });
    });
  });
  
  describe("testConnection", () => {
    it("returns success: true when health check passes", async () => {
      globalThis.fetch = async () => new Response("OK", { status: 200 });
      
      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });
    
    it("returns success: false when health check fails", async () => {
      globalThis.fetch = async () => new Response("Error", { status: 500 });
      
      const result = await client.testConnection();
      expect(result.success).toBe(false);
    });
  });
});
```

## Success Criteria:

### Automated Verification:
- [ ] `bun test tests/client.test.ts` passes
- [ ] `bun run typecheck` passes

### Manual Verification:
- [ ] `/opensync-config` → "Test connection" works with valid config

### Commit Checkpoint:
After all verifications pass, commit with message:
```
Add OpenSync API client with connection testing
```
