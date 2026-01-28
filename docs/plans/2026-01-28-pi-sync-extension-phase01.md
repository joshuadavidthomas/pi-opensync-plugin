# Phase 1: Project Setup & Core Types

## Overview
Initialize the bun project, define TypeScript interfaces, and establish a minimal extension skeleton with no external dependencies on files that don't exist yet.

## Changes Required:

### 1. Initialize Project
**File**: `package.json`

```json
{
  "name": "pi-opensync-plugin",
  "version": "0.1.0",
  "description": "Pi extension to sync sessions to OpenSync dashboards",
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.50.0"
  }
}
```

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

### 2. Pi Settings for Development (Fallback Approach - Used)
**ACTUALLY IMPLEMENTED**: Symlink approach

The `.pi/settings.json` approach did not work (command not found after reload), so we used the symlink fallback:

```bash
mkdir -p .pi/extensions
ln -s ../../src .pi/extensions/pi-opensync-plugin
```

This uses pi's native auto-discovery from `.pi/extensions/*/index.ts`.

### 3. Define Types
**File**: `src/types.ts`

```typescript
/**
 * Configuration for pi-opensync-plugin extension
 */
export interface Config {
  /** OpenSync Convex URL (will be normalized to .convex.site) */
  convexUrl: string;
  /** OpenSync API key (osk_xxxxx) */
  apiKey: string;
  /** Enable auto-sync (default: true) */
  autoSync?: boolean;
  /** Sync tool calls as separate messages (default: false) */
  syncToolCalls?: boolean;
  /** Include thinking/reasoning content in messages (default: false) */
  syncThinking?: boolean;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Session data for OpenSync API
 */
export interface SessionPayload {
  externalId: string;
  source: "pi";
  title?: string;
  projectPath?: string;
  projectName?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  messageCount?: number;
}

/**
 * Message data for OpenSync API
 */
export interface MessagePayload {
  sessionExternalId: string;
  externalId: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  textContent?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  createdAt?: number;
}

/**
 * Internal session state tracked by the extension
 */
export interface SessionState {
  /** OpenSync external ID (pi session UUID) */
  externalId: string;
  /** Parent session ID if this is a fork */
  parentExternalId?: string;
  /** Project working directory */
  projectPath: string;
  /** Project name (basename of projectPath) */
  projectName: string;
  /** Session start timestamp */
  startedAt: number;
  /** Current model ID */
  model?: string;
  /** Current model provider */
  provider?: string;
  /** Accumulated input tokens */
  promptTokens: number;
  /** Accumulated output tokens */
  completionTokens: number;
  /** Accumulated total cost */
  cost: number;
  /** Message counter for ID generation */
  messageCount: number;
  /** Tool call counter */
  toolCallCount: number;
}

/**
 * Result from OpenSync API calls
 */
export interface SyncResult {
  success: boolean;
  error?: string;
}
```

### 4. Minimal Extension Skeleton
**File**: `src/index.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  // Phase 1: Minimal skeleton
  // Configuration, client, and event handlers will be added in subsequent phases
  
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-opensync-plugin loaded! Config not yet implemented.", "info");
    },
  });
}
```

## Success Criteria:

### Automated Verification:
- [x] `bun install` completes successfully
- [x] `bun run typecheck` passes with no errors

### Manual Verification:
- [x] `/reload` loads the extension without errors
- [x] `/opensync-config` shows "pi-opensync-plugin loaded!" notification

### Commit Checkpoint:
After all verifications pass, commit with message:
```
Add pi-opensync-plugin skeleton with types
```

## Implementation Notes

### Deviations from Original Plan

**1. MessagePayload structure changed:**
- **Planned:** Simple `textContent` only field
- **Actual:** Added `parts?: MessagePart[]` field to support structured content (tool calls, tool results, thinking blocks)
- **Reason:** OpenSync API supports structured parts for richer message display, which we need for tool calls and results

**2. MessagePart interface added:**
- **Not in original plan:** New `MessagePart` interface with `type` and `content` fields
- **Reason:** Required to represent structured parts like tool calls, tool results, and thinking blocks

**3. Config syncToolCalls default changed:**
- **Planned:** `default: false`
- **Actual:** `default: true` (opt-out instead of opt-in)
- **Reason:** Tool results are now parts of assistant messages (not separate messages), so syncing them by default provides better UX

These changes were necessary to properly handle the OpenSync API's structured parts feature and to work around UI limitations (see `docs/opensync-ui-workarounds.md`).
