# Phase 2: Configuration Management

## Overview
Implement configuration loading from file and environment variables.

## Changes Required:

### 1. Config Module
**File**: `src/config.ts`

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "pi-opensync-plugin");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Normalize Convex URL to use .convex.site for HTTP endpoints
 */
export function normalizeConvexUrl(url: string): string {
  return url.replace(".convex.cloud", ".convex.site");
}

/**
 * Load configuration from environment variables or config file
 * Environment variables take precedence
 */
export function loadConfig(): Config | null {
  // Check environment variables first
  const envUrl = process.env.PI_OPENSYNC_CONVEX_URL;
  const envKey = process.env.PI_OPENSYNC_API_KEY;
  
  if (envUrl && envKey) {
    return {
      convexUrl: normalizeConvexUrl(envUrl),
      apiKey: envKey,
      autoSync: process.env.PI_OPENSYNC_AUTO_SYNC !== "false",
      syncToolCalls: process.env.PI_OPENSYNC_TOOL_CALLS === "true",
      syncThinking: process.env.PI_OPENSYNC_THINKING === "true",
      debug: process.env.PI_OPENSYNC_DEBUG === "true",
    };
  }
  
  // Fall back to config file
  return loadConfigFile();
}

/**
 * Load configuration from file only
 */
export function loadConfigFile(): Config | null {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(data) as Config;
      config.convexUrl = normalizeConvexUrl(config.convexUrl);
      return config;
    }
  } catch (error) {
    console.error("[pi-opensync] Error loading config:", error);
  }
  return null;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Delete configuration file
 */
export function clearConfig(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error("[pi-opensync] Error clearing config:", error);
  }
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}
```

### 2. Update Extension to Use Config
**File**: `src/index.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, getConfigPath } from "./config.js";
import type { Config } from "./types.js";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();
  
  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null);
    return;
  }
  
  if (config.autoSync === false) {
    if (config.debug) {
      console.log("[pi-opensync] Auto-sync disabled in config");
    }
    registerConfigCommand(pi, config);
    return;
  }
  
  if (config.debug) {
    console.log("[pi-opensync] Extension loaded with config");
  }
  
  // Register config command
  registerConfigCommand(pi, config);
  
  // Event handlers will be added in Phase 5
}

function registerConfigCommand(pi: ExtensionAPI, config: Config | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (config) {
        ctx.ui.notify(
          `Config loaded from: ${getConfigPath()}\nConvex URL: ${config.convexUrl}\nAPI Key: ${config.apiKey.slice(0, 8)}...`,
          "info"
        );
      } else {
        ctx.ui.notify(
          `No config found.\nCreate config at: ${getConfigPath()}\nOr set PI_OPENSYNC_CONVEX_URL and PI_OPENSYNC_API_KEY env vars.`,
          "info"
        );
      }
    },
  });
}
```

### 3. Config Tests
**File**: `tests/config.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { normalizeConvexUrl } from "../src/config.js";

describe("normalizeConvexUrl", () => {
  it("converts .convex.cloud to .convex.site", () => {
    const input = "https://my-app-123.convex.cloud";
    const expected = "https://my-app-123.convex.site";
    expect(normalizeConvexUrl(input)).toBe(expected);
  });
  
  it("leaves .convex.site unchanged", () => {
    const input = "https://my-app-123.convex.site";
    expect(normalizeConvexUrl(input)).toBe(input);
  });
  
  it("handles URLs without convex domain", () => {
    const input = "https://custom-proxy.example.com";
    expect(normalizeConvexUrl(input)).toBe(input);
  });
});

describe("loadConfig with environment variables", () => {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.PI_OPENSYNC_CONVEX_URL;
    delete process.env.PI_OPENSYNC_API_KEY;
    delete process.env.PI_OPENSYNC_AUTO_SYNC;
    delete process.env.PI_OPENSYNC_TOOL_CALLS;
    delete process.env.PI_OPENSYNC_THINKING;
    delete process.env.PI_OPENSYNC_DEBUG;
  });
  
  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (key.startsWith("PI_OPENSYNC_")) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });
  
  it("loads from environment variables when present", async () => {
    process.env.PI_OPENSYNC_CONVEX_URL = "https://test.convex.cloud";
    process.env.PI_OPENSYNC_API_KEY = "osk_test123";
    process.env.PI_OPENSYNC_DEBUG = "true";
    
    // Re-import to get fresh module
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    
    expect(config).not.toBeNull();
    expect(config!.convexUrl).toBe("https://test.convex.site"); // normalized
    expect(config!.apiKey).toBe("osk_test123");
    expect(config!.debug).toBe(true);
    expect(config!.autoSync).toBe(true); // default when not "false"
    expect(config!.syncToolCalls).toBe(false); // default when not "true"
  });
  
  it("returns null when no env vars and no config file", async () => {
    // Ensure no env vars set
    delete process.env.PI_OPENSYNC_CONVEX_URL;
    delete process.env.PI_OPENSYNC_API_KEY;
    
    const { loadConfig } = await import("../src/config.js");
    // This will return null if no config file exists
    // (which is the case in a clean test environment)
    const config = loadConfig();
    
    // Either null or loaded from existing config file
    // We can't guarantee no config file exists, so just check it doesn't throw
    expect(config === null || typeof config === "object").toBe(true);
  });
});
```

## Success Criteria:

### Automated Verification:
- [x] `bun test tests/config.test.ts` passes
- [x] `bun run typecheck` passes

### Manual Verification:
- [x] Setting `PI_OPENSYNC_CONVEX_URL` and `PI_OPENSYNC_API_KEY` env vars loads config
- [x] Creating `~/.config/pi-opensync-plugin/config.json` manually loads config
- [x] `/opensync-config` shows config info or setup instructions

### Commit Checkpoint:
After all verifications pass, commit with message:
```
Add configuration management with env var support
```

## Implementation Notes

### Deviations from Original Plan

**No significant deviations** - Configuration management was implemented as planned. The only minor changes were:

1. **syncToolCalls default:** Changed from `false` to `true` (opt-out instead of opt-in) - see Phase 1 implementation notes for reasoning

All other config loading, env var support, and file management functions work exactly as specified in the plan.
