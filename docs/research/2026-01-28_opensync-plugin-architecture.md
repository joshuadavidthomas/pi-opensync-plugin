---
date: 2026-01-28T09:54:31-06:00
query: "How do OpenSync and its plugins interact with agentic harnesses/tools?"
repository: null
branch: main
commit: 153a3393
cwd: /home/josh/projects/joshuadavidthomas/pi-sync
tags: [opensync, plugins, sync, api, hooks, events, agentic-tools]
---

# Research: OpenSync Plugin Architecture

## Summary

OpenSync plugins sync AI coding agent sessions to a centralized dashboard via HTTP REST endpoints. Each plugin adapts to the hook/event system of its target agentic tool (Claude Code, OpenCode, Cursor, Codex, Droid), transforms session and message data to a common format, and sends it to the OpenSync Convex backend. The architecture follows a consistent pattern: listen for lifecycle events → accumulate session state → sync to `/sync/session`, `/sync/message`, or `/sync/batch` endpoints with Bearer token authentication.

## Detailed Findings

### OpenSync Backend API

The OpenSync backend (`ref/opensync/convex/http.ts`) exposes three primary sync endpoints:

#### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sync/session` | POST | Create or update a session |
| `/sync/message` | POST | Add a message to a session |
| `/sync/batch` | POST | Batch sync multiple sessions and messages |
| `/sync/sessions/list` | GET | List all session external IDs |
| `/health` | GET | Health check |

#### Authentication

All sync endpoints require Bearer token authentication via API key:
```
Authorization: Bearer osk_xxxxx
```

The backend validates API keys against the `users` table and retrieves the associated user ID for data ownership.

#### Session Data Structure

From `ref/opensync/convex/schema.ts:34-74`, sessions store:

```typescript
{
  userId: Id<"users">,           // Owner
  externalId: string,            // Plugin's session ID
  title?: string,                // Session title
  projectPath?: string,          // Working directory
  projectName?: string,          // Extracted project name
  model?: string,                // LLM model used
  provider?: string,             // Model provider
  source?: string,               // "opencode", "claude-code", "codex-cli", etc.
  promptTokens: number,          // Input tokens
  completionTokens: number,      // Output tokens
  totalTokens: number,           // Total tokens
  cost: number,                  // Estimated cost
  durationMs?: number,           // Session duration
  messageCount: number,          // Number of messages
  // ... eval fields, timestamps
}
```

#### Message Data Structure

From `ref/opensync/convex/schema.ts:76-98`, messages store:

```typescript
{
  sessionId: Id<"sessions">,
  externalId: string,            // Plugin's message ID
  role: "user" | "assistant" | "system" | "tool" | "unknown",
  textContent?: string,          // Message content
  model?: string,
  promptTokens?: number,
  completionTokens?: number,
  durationMs?: number,
  createdAt: number,
}
```

### Plugin Integration Patterns

Each plugin follows a common architecture but adapts to its target tool's hook system:

#### 1. Claude Code Plugin (`ref/claude-code-sync/`)

**Hook System:** Claude Code exposes named hooks that the plugin exports as functions:

```typescript
export interface ClaudeCodeHooks {
  SessionStart?: (data: SessionStartEvent) => void | Promise<void>;
  UserPromptSubmit?: (data: UserPromptEvent) => void | Promise<void>;
  PostToolUse?: (data: ToolUseEvent) => void | Promise<void>;
  Stop?: (data: StopEvent) => void | Promise<void>;
  SessionEnd?: (data: SessionEndEvent) => void | Promise<void>;
}
```

**Data Flow:**
1. `SessionStart` - Creates session with project path, git branch, model info
2. `UserPromptSubmit` - Syncs user message
3. `PostToolUse` - Syncs tool calls (if configured)
4. `Stop` - Syncs assistant response with token usage
5. `SessionEnd` - Finalizes session with totals, parses transcript for accurate token counts

**Key Feature:** Parses Claude Code's JSONL transcript files for accurate token usage:
```typescript
function parseTranscript(transcriptPath: string): TranscriptStats {
  // Reads lines from transcript file
  // Extracts model, tokens, message counts
}
```

**Config:** `~/.config/claude-code-sync/config.json` or environment variables

---

#### 2. OpenCode Plugin (`ref/opencode-sync-plugin/`)

**Hook System:** OpenCode uses an event-based plugin system:

```typescript
export const OpenCodeSyncPlugin: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      // Handle events by type
    },
  };
};
```

**Events Handled:**
- `session.created` / `session.updated` / `session.idle` - Session lifecycle
- `message.updated` - Message metadata
- `message.part.updated` - Message text content

**Key Pattern:** Debounces message syncing to combine parts:
```typescript
const DEBOUNCE_MS = 800;
// Waits for message parts to accumulate before syncing
```

**Local Storage Integration:** Reads from `~/.local/share/opencode/storage/` for additional data:
```typescript
function getLocalSessionData(sessionId: string): LocalSessionData | null {
  // Reads session files for title, tokens, cost
}
```

---

#### 3. Codex CLI Plugin (`ref/codex-sync-plugin/`)

**Hook System:** Codex uses CLI hooks called via `codex-sync hook <event-name> <json>`:

```typescript
export async function handleHook(event: string, jsonPayload?: string): Promise<void> {
  if (event !== 'agent-turn-complete') return;
  await handleAgentTurnComplete(jsonPayload, config.debug);
}
```

**Session Parsing:** Reads Codex session files (JSONL format) from `~/.codex/sessions/`:

```typescript
interface RolloutItem = 
  | RolloutItemSessionMeta 
  | RolloutItemResponse 
  | RolloutItemEvent
  | RolloutItemTurnContext;
```

**Key Pattern:** Parses entire session file on `agent-turn-complete`:
```typescript
async function handleAgentTurnComplete(): Promise<void> {
  const sessionFile = findSessionById() || getMostRecentSession();
  const session = parseSessionFile(sessionFile);
  await syncFullSession(session);
}
```

---

#### 4. Cursor CLI Plugin (`ref/cursor-cli-sync-plugin/`)

**Hook System:** Cursor passes JSON payloads via stdin, expects JSON response on stdout:

```typescript
export async function readPayload(): Promise<CursorHookPayload | null> {
  // Read JSON from stdin
}

export function writeResponse(response: HookResponse): void {
  console.log(JSON.stringify(response));
}
```

**Events:**
- `beforeSubmitPrompt` - User prompt, creates/updates session
- `beforeShellExecution` - Shell commands (tool calls)
- `beforeMCPExecution` - MCP tool calls
- `afterFileEdit` - File modifications with diffs
- `afterAgentResponse` - Assistant response
- `stop` - Session end

**Key Pattern:** Non-blocking observation:
```typescript
export function allowAction(): void {
  writeResponse({ continue: true, permission: "allow" });
}
// Always allows actions to proceed
```

---

#### 5. Factory Droid Plugin (`ref/droid-sync-plugin/`)

**Hook System:** Similar to Cursor, reads JSON from stdin:

```typescript
export async function dispatchHook(eventName: string): Promise<void> {
  const inputJson = await readStdin();
  const input: HookInput = JSON.parse(inputJson);
  
  switch (normalizedEvent) {
    case "stop": await handleStop(input); break;
    case "sessionend": await handleSessionEnd(input); break;
  }
}
```

**Transcript Parsing:** Reads transcript JSONL and session settings:
```typescript
const transcript = parseTranscript(input.transcriptPath);
const settings = parseSessionSettings(input.transcriptPath);
```

**Session Settings:** Reads `.settings.json` for token usage and model info.

### Common Patterns Across Plugins

#### 1. Configuration Management

All plugins use similar config patterns:
- Config file location: `~/.config/<plugin-name>/config.json`
- Environment variable overrides
- Required fields: `convexUrl`, `apiKey`
- Optional: `autoSync`, `syncToolCalls`, `syncThinking`, `debug`

```typescript
interface Config {
  convexUrl: string;    // OpenSync deployment URL
  apiKey: string;       // User's API key
  autoSync?: boolean;   // Enable auto-sync (default: true)
  syncToolCalls?: boolean;
  syncThinking?: boolean;
}
```

#### 2. URL Normalization

Plugins normalize the Convex URL for HTTP endpoints:
```typescript
const siteUrl = config.convexUrl.replace(".convex.cloud", ".convex.site");
```

#### 3. Session State Tracking

Plugins maintain local state for session accumulation:
```typescript
class SyncClient {
  private sessionCache: Map<string, Partial<SessionData>> = new Map();
  
  updateSessionState(sessionId: string, updates: Partial<SessionData>): void {
    const current = this.sessionCache.get(sessionId) || {};
    this.sessionCache.set(sessionId, { ...current, ...updates });
  }
}
```

#### 4. Message ID Generation

Unique message IDs follow patterns like:
```typescript
const messageId = `${sessionId}-msg-${messageCounter}`;
const toolId = `${sessionId}-tool-${toolCallCounter}`;
```

#### 5. Silent Failure

All plugins fail silently to avoid disrupting the user's workflow:
```typescript
try {
  await client.syncSession(session);
} catch (error) {
  if (config.debug) {
    console.error('[plugin] Sync failed:', error);
  }
  // Don't throw - continue silently
}
```

### Data Transformation

Each plugin transforms its tool's data format to OpenSync's expected format:

| Plugin | Source Field | OpenSync Field |
|--------|--------------|----------------|
| Claude Code | `tokenUsage.input` | `promptTokens` |
| OpenCode | `tokens.input` | `promptTokens` |
| Codex | `total_token_usage.input_tokens` | `promptTokens` |
| Cursor | (computed from messages) | `promptTokens` |
| Droid | `tokenUsage.inputTokens` | `promptTokens` |

### pi Extension System (Target Platform)

For the pi-sync plugin, the pi extension system (`ref/pi-mono/packages/coding-agent/docs/extensions.md`) provides:

**Key Events:**
- `session_start` - Session begins
- `session_shutdown` - Session ends
- `agent_start` / `agent_end` - Agent processing lifecycle
- `turn_start` / `turn_end` - Each LLM turn
- `tool_call` / `tool_result` - Tool execution
- `input` - User input

**Extension API:**
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // ctx.sessionManager.getSessionFile()
    // ctx.cwd
  });
  
  pi.on("tool_result", async (event, ctx) => {
    // event.toolName, event.toolCallId, event.content, event.details
  });
  
  pi.on("turn_end", async (event, ctx) => {
    // event.message, event.toolResults
  });
}
```

**State Persistence:**
```typescript
pi.appendEntry("my-state", { data: ... });
// Restored via ctx.sessionManager.getEntries()
```

## Code References

Key locations for future reference:

- `ref/opensync/convex/http.ts:83-120` - Sync session endpoint
- `ref/opensync/convex/http.ts:123-150` - Sync message endpoint
- `ref/opensync/convex/http.ts:153-198` - Batch sync endpoint
- `ref/opensync/convex/schema.ts:34-98` - Session and message schemas
- `ref/claude-code-sync/src/index.ts:251-350` - SyncClient implementation
- `ref/claude-code-sync/src/index.ts:360-500` - Hook handlers
- `ref/opencode-sync-plugin/src/index.ts:130-230` - Event handlers
- `ref/codex-sync-plugin/src/hook.ts:1-80` - Codex hook handling
- `ref/cursor-cli-sync-plugin/hooks.ts:30-200` - Cursor hook handlers
- `ref/droid-sync-plugin/src/hooks.ts:20-80` - Droid hook handlers
- `ref/pi-mono/packages/coding-agent/docs/extensions.md:1-200` - pi extension system

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agentic Tool                                  │
│  (Claude Code / OpenCode / Cursor / Codex / Droid / pi)             │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Hook/Event System                                │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  Session   │  │   User     │  │   Tool     │  │  Session   │    │
│  │   Start    │  │   Prompt   │  │  Execution │  │    End     │    │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘    │
└────────┼───────────────┼───────────────┼───────────────┼────────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Sync Plugin                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Session State Cache                       │   │
│  │  - sessionId, title, projectPath, model                     │   │
│  │  - tokenUsage (accumulated), messageCount, toolCallCount    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  Transform  │  │  Transform  │  │  Transform  │                 │
│  │  Session    │  │  Message    │  │  Tool Call  │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     HTTP Sync Client                                 │
│                                                                      │
│  POST /sync/session   POST /sync/message   POST /sync/batch         │
│                                                                      │
│  Authorization: Bearer osk_xxxxx                                     │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    OpenSync Backend (Convex)                         │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   users     │  │  sessions   │  │  messages   │                 │
│  │   table     │  │   table     │  │   table     │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Notes for pi-sync

Based on this research, a pi-sync plugin should:

1. **Use pi events:** `session_start`, `turn_end`, `tool_result`, `session_shutdown`
2. **Accumulate state:** Track tokens, messages, tool calls in memory
3. **Sync on key events:** 
   - `session_start` → initial `/sync/session`
   - `turn_end` → sync messages
   - `session_shutdown` → final `/sync/session` with totals
4. **Config location:** `~/.config/pi-sync/config.json`
5. **Source identifier:** Use `"pi"` as the source field
6. **Silent failures:** Never throw, only log if debug enabled
7. **Message ID format:** `${sessionId}-${role}-${timestamp}`

## Open Questions

1. **Token tracking in pi:** How does pi expose token usage? Need to check if `turn_end` or `agent_end` events include usage data.
2. **Session ID format:** Does pi use file paths, UUIDs, or another format for session identification?
3. **Compaction handling:** How should the plugin handle pi's compaction feature (session summaries)?
4. **Branch/fork handling:** Pi supports session branching - should these create new OpenSync sessions?
