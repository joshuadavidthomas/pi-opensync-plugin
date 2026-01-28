---
date: 2026-01-28T10:01:02-06:00
query: "What pi extension API features are available for building an OpenSync plugin?"
repository: null
branch: main
commit: 153a3393
cwd: /home/josh/projects/joshuadavidthomas/pi-sync
tags: [pi, extensions, api, events, sessions, tokens, opensync]
---

# Research: Pi Extension API Deep Dive

## Summary

The pi coding agent provides a comprehensive extension system that maps well to OpenSync's requirements. Extensions can subscribe to lifecycle events, access session data including token usage, persist state, and interact with external services. Key events for sync include `session_start`, `turn_end`, `agent_end`, and `session_shutdown`. Token usage is available via `AssistantMessage.usage` in turn/agent end events. Session IDs are UUIDs accessible via `ctx.sessionManager.getSessionId()`.

## Detailed Findings

### Extension System Overview

Pi extensions are TypeScript modules that export a default function receiving `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("session_start", async (event, ctx) => { ... });
  
  // Register commands
  pi.registerCommand("my-cmd", { ... });
  
  // Persist state
  pi.appendEntry("my-state", { data: ... });
}
```

**Extension Locations:**
- Global: `~/.pi/agent/extensions/*.ts`
- Project-local: `.pi/extensions/*.ts`
- Directory-based: `~/.pi/agent/extensions/my-ext/index.ts`
- With dependencies: Include `package.json` and `node_modules/`

Extensions are hot-reloadable with `/reload` when in auto-discovered locations.

---

### Events for OpenSync Integration

#### Session Lifecycle Events

| Event | When Fired | Key Data | OpenSync Use |
|-------|-----------|----------|--------------|
| `session_start` | Initial session load | `ctx.sessionManager`, `ctx.cwd` | Initialize sync, create session |
| `session_shutdown` | Exit (Ctrl+C, Ctrl+D, SIGTERM) | Full session data available | Finalize sync with totals |
| `session_switch` | After `/new` or `/resume` | `event.reason`, `event.previousSessionFile` | Handle session changes |
| `session_fork` | After `/fork` | `event.previousSessionFile` | Create new OpenSync session |

#### Agent/Turn Events

| Event | When Fired | Key Data | OpenSync Use |
|-------|-----------|----------|--------------|
| `turn_start` | Start of each LLM turn | `event.turnIndex`, `event.timestamp` | Optional: track turn timing |
| `turn_end` | End of each LLM turn | `event.message`, `event.toolResults` | **Primary sync point** - message + tokens |
| `agent_start` | Start of agent loop (per user prompt) | None | Track user prompt timing |
| `agent_end` | End of agent loop | `event.messages` | Batch sync all messages |
| `input` | User input received | `event.text`, `event.images`, `event.source` | Track user messages |

#### Tool Events

| Event | When Fired | Key Data | OpenSync Use |
|-------|-----------|----------|--------------|
| `tool_call` | Before tool executes | `event.toolName`, `event.toolCallId`, `event.input` | Track tool usage (optional) |
| `tool_result` | After tool executes | `event.content`, `event.details`, `event.isError` | Track tool results (optional) |

---

### Accessing Session Data

#### Session Manager (`ctx.sessionManager`)

The session manager is read-only in event handlers and provides:

```typescript
// Session identification
ctx.sessionManager.getSessionId()      // UUID string
ctx.sessionManager.getSessionFile()    // File path or undefined (ephemeral)
ctx.sessionManager.getCwd()            // Working directory

// Session content
ctx.sessionManager.getEntries()        // All entries (messages, tool results, etc.)
ctx.sessionManager.getBranch()         // Current branch entries only
ctx.sessionManager.getLeafId()         // Current position in tree
ctx.sessionManager.getSessionName()    // Display name if set

// Context info
ctx.sessionManager.getHeader()         // Session metadata (id, timestamp, cwd)
```

#### Current Model (`ctx.model`)

```typescript
ctx.model?.id         // Model ID (e.g., "claude-sonnet-4-5")
ctx.model?.provider   // Provider name (e.g., "anthropic")
ctx.model?.name       // Display name
ctx.model?.reasoning  // Whether model supports thinking
```

---

### Token Usage Structure

Token usage is available in `AssistantMessage.usage`. The `AssistantMessage` type:

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}

interface Usage {
  input: number;       // Input tokens
  output: number;      // Output tokens
  cacheRead: number;   // Cached prompt tokens read
  cacheWrite: number;  // Cached prompt tokens written
  totalTokens: number; // Total tokens
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;     // Total cost in USD
  };
}
```

**Accessing in `turn_end`:**

```typescript
pi.on("turn_end", async (event, ctx) => {
  const msg = event.message;
  if (msg.role === "assistant") {
    const { usage } = msg;
    console.log(`Input: ${usage.input}, Output: ${usage.output}`);
    console.log(`Cost: $${usage.cost.total}`);
  }
});
```

---

### Message Types in Session

Pi uses a union type `AgentMessage` for all messages:

```typescript
type AgentMessage =
  | UserMessage           // role: "user"
  | AssistantMessage      // role: "assistant"
  | ToolResultMessage     // role: "toolResult"
  | BashExecutionMessage  // role: "bashExecution"
  | CustomMessage         // role: "custom"
  | BranchSummaryMessage  // role: "branchSummary"
  | CompactionSummaryMessage; // role: "compactionSummary"
```

**Mapping to OpenSync roles:**

| Pi Role | OpenSync Role | Notes |
|---------|---------------|-------|
| `user` | `user` | Direct mapping |
| `assistant` | `assistant` | Contains thinking, text, and tool calls |
| `toolResult` | `tool` | Tool execution results |
| `bashExecution` | `tool` or skip | User's `!` commands |
| `custom` | Skip or `unknown` | Extension messages |
| `branchSummary` | Skip | Internal tree navigation |
| `compactionSummary` | Skip or `system` | Context compaction |

---

### State Persistence

Extensions can persist state that survives session reloads using `pi.appendEntry()`:

```typescript
interface SyncState {
  lastSyncTimestamp: number;
  messageCount: number;
  totalTokens: { input: number; output: number };
}

// Save state
pi.appendEntry<SyncState>("pi-sync-state", {
  lastSyncTimestamp: Date.now(),
  messageCount: 42,
  totalTokens: { input: 5000, output: 3000 },
});

// Restore on session start
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "pi-sync-state") {
      const state = entry.data as SyncState;
      // Reconstruct from state...
    }
  }
});
```

**Important:** State is branch-aware. Use `getBranch()` to get entries in the current branch only.

---

### Configuration Patterns

Pi extensions commonly use JSON config files:

**Pattern 1: Extension-adjacent config**

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "pi-sync");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  convexUrl: string;
  apiKey: string;
  autoSync?: boolean;
  syncToolCalls?: boolean;
}

function loadConfig(): Config | null {
  // Check environment variables first
  const envUrl = process.env.PI_SYNC_CONVEX_URL;
  const envKey = process.env.PI_SYNC_API_KEY;
  
  if (envUrl && envKey) {
    return {
      convexUrl: normalizeConvexUrl(envUrl),
      apiKey: envKey,
      autoSync: process.env.PI_SYNC_AUTO_SYNC !== "false",
    };
  }
  
  // Fall back to config file
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  
  return null;
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
```

**Pattern 2: Pi extension directory config**

Some extensions use `~/.pi/agent/extensions/<name>.json`:

```typescript
const globalPath = join(homedir(), ".pi", "agent", "extensions", "pi-sync.json");
const projectPath = join(cwd, ".pi", "extensions", "pi-sync.json");
```

---

### ExtensionContext Properties

Event handlers receive `ctx: ExtensionContext`:

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;           // UI methods (dialogs, status, etc.)
  hasUI: boolean;                   // false in print/RPC mode
  cwd: string;                      // Working directory
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;     // For API key resolution
  model: Model<any> | undefined;    // Current model
  
  // Methods
  isIdle(): boolean;                // Is agent currently idle?
  abort(): void;                    // Abort current operation
  hasPendingMessages(): boolean;    // Are messages queued?
  shutdown(): void;                 // Graceful shutdown
  getContextUsage(): ContextUsage | undefined;  // Token usage
  compact(options?: CompactOptions): void;      // Trigger compaction
}
```

---

### UI Feedback (Optional)

For user feedback, use `ctx.ui` methods (only when `ctx.hasUI === true`):

```typescript
// Notifications (non-blocking)
ctx.ui.notify("Session synced!", "info");      // "info" | "warning" | "error"

// Status in footer (persistent)
ctx.ui.setStatus("pi-sync", "● Syncing...");
ctx.ui.setStatus("pi-sync", undefined);  // Clear

// Working message during streaming
ctx.ui.setWorkingMessage("Syncing to OpenSync...");
ctx.ui.setWorkingMessage();  // Restore default
```

---

### Recommended Event Flow for OpenSync

```
session_start
    │
    ├─► Initialize SyncClient
    ├─► Load config
    ├─► Get session ID: ctx.sessionManager.getSessionId()
    ├─► Get project info from ctx.cwd
    └─► POST /sync/session (initial)

turn_end (repeats for each turn)
    │
    ├─► Extract message from event.message
    ├─► Extract usage from AssistantMessage.usage
    ├─► Update running totals
    └─► POST /sync/message (or batch)

session_shutdown
    │
    ├─► Calculate final totals
    ├─► POST /sync/session (final update with totals)
    └─► Cleanup
```

---

### Complete Event Data Types

#### TurnEndEvent

```typescript
interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;           // 0-indexed turn number
  message: AgentMessage;       // The assistant message
  toolResults: ToolResultMessage[];  // Tool results from this turn
}
```

#### AgentEndEvent

```typescript
interface AgentEndEvent {
  type: "agent_end";
  messages: AgentMessage[];    // All messages from this agent loop
}
```

#### SessionStartEvent

```typescript
interface SessionStartEvent {
  type: "session_start";
  // No additional data - use ctx for all info
}
```

#### SessionShutdownEvent

```typescript
interface SessionShutdownEvent {
  type: "session_shutdown";
  // No additional data - use ctx for all info
}
```

---

### Project Path Extraction

Extract project name from working directory:

```typescript
import { basename } from "node:path";

const projectPath = ctx.cwd;
const projectName = basename(projectPath);
```

Git branch extraction (from Claude Code plugin pattern):

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function getGitBranch(cwd: string): string | undefined {
  try {
    const headFile = join(cwd, ".git", "HEAD");
    if (existsSync(headFile)) {
      const head = readFileSync(headFile, "utf-8").trim();
      if (head.startsWith("ref: refs/heads/")) {
        return head.replace("ref: refs/heads/", "");
      }
    }
  } catch {
    // Not a git repo or error
  }
  return undefined;
}
```

---

### Exec Helper

For running external commands:

```typescript
const result = await pi.exec("git", ["rev-parse", "--short", "HEAD"], {
  timeout: 5000,
  signal,
});

// result.stdout, result.stderr, result.code, result.killed
if (result.code === 0) {
  const commit = result.stdout.trim();
}
```

---

## Code References

Key source files in pi-mono:

- `ref/pi-mono/packages/coding-agent/src/core/extensions/types.ts:1-900` - All extension types
- `ref/pi-mono/packages/coding-agent/docs/extensions.md:1-1700` - Full extension documentation
- `ref/pi-mono/packages/coding-agent/docs/session.md:1-400` - Session format and manager
- `ref/pi-mono/packages/ai/src/types.ts:1-200` - Message and usage types
- `ref/pi-mono/packages/coding-agent/examples/extensions/tools.ts` - State persistence pattern
- `ref/pi-mono/packages/coding-agent/examples/extensions/notify.ts` - Desktop notifications
- `ref/pi-mono/packages/coding-agent/examples/extensions/status-line.ts` - Status UI pattern

## Mapping to OpenSync Requirements

| OpenSync Need | Pi Extension Feature |
|---------------|---------------------|
| Session ID | `ctx.sessionManager.getSessionId()` |
| Project path | `ctx.cwd` |
| Project name | `basename(ctx.cwd)` |
| Model | `ctx.model?.id`, `ctx.model?.provider` |
| Prompt tokens | `AssistantMessage.usage.input` |
| Completion tokens | `AssistantMessage.usage.output` |
| Total tokens | `AssistantMessage.usage.totalTokens` |
| Cost | `AssistantMessage.usage.cost.total` |
| Message role | `message.role` |
| Message content | `message.content` (array of TextContent, etc.) |
| Tool calls | `ToolCall` in `AssistantMessage.content` |
| Tool results | `ToolResultMessage` or `event.toolResults` |
| Session start | `session_start` event |
| Session end | `session_shutdown` event |
| Each message | `turn_end` or `agent_end` events |
| Config storage | `~/.config/pi-sync/config.json` |
| Env vars | `process.env.PI_SYNC_*` |

## Implementation Skeleton

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

interface Config {
  convexUrl: string;
  apiKey: string;
  autoSync?: boolean;
  syncToolCalls?: boolean;
}

interface SessionState {
  sessionId: string;
  projectPath: string;
  startedAt: string;
  messageCount: number;
  toolCallCount: number;
  totalTokens: { input: number; output: number };
  totalCost: number;
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) return;
  
  let state: SessionState | null = null;
  let messageCounter = 0;
  
  pi.on("session_start", async (_event, ctx) => {
    state = {
      sessionId: ctx.sessionManager.getSessionId(),
      projectPath: ctx.cwd,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      toolCallCount: 0,
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };
    
    await syncSession(config, state);
  });
  
  pi.on("turn_end", async (event, ctx) => {
    if (!state) return;
    
    const msg = event.message;
    if (msg.role === "assistant") {
      state.messageCount++;
      state.totalTokens.input += msg.usage.input;
      state.totalTokens.output += msg.usage.output;
      state.totalCost += msg.usage.cost.total;
      
      // Count tool calls
      for (const part of msg.content) {
        if (part.type === "toolCall") {
          state.toolCallCount++;
        }
      }
      
      await syncMessage(config, state.sessionId, msg, messageCounter++);
    }
  });
  
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!state) return;
    
    state.endedAt = new Date().toISOString();
    await syncSession(config, state, "final");
  });
}

// Implementation details omitted - see full implementation
```

## Open Questions

1. **Compaction handling:** When a session is compacted, should we update the OpenSync session with compaction info? The `session_compact` event provides `tokensBefore`.

2. **Branch/fork handling:** Pi supports session branching (`/tree`) and forking (`/fork`). Should branches create new OpenSync sessions or update the same one?

3. **Model changes mid-session:** The `model_select` event fires when the model changes. Should we track model changes in OpenSync?

4. **RPC mode support:** In RPC mode (`ctx.hasUI === false`), the plugin should still sync but skip UI feedback.

5. **Error handling:** Should sync failures be silent, logged, or surfaced to the user? Other plugins use silent failure with optional debug logging.
