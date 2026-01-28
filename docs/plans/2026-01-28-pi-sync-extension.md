# pi-opensync-plugin Implementation Plan

## Overview

Build a pi coding agent extension that syncs coding sessions to OpenSync dashboards in real-time. The extension follows patterns established by existing OpenSync plugins (Claude Code, OpenCode, Codex) while leveraging pi's rich extension API for configuration UX.

## Current State Analysis

### OpenSync API
- REST endpoints at `https://<deployment>.convex.site/sync/*`
- `POST /sync/session` - Create/update session
- `POST /sync/message` - Add message to session
- `POST /sync/batch` - Batch sync sessions and messages
- Bearer token authentication (`Authorization: Bearer osk_xxxxx`)
- **Note**: We only support API key authentication (users get `osk_xxxxx` keys from OpenSync dashboard). We are NOT implementing OAuth/browser-based login flows that some other plugins support.

### Pi Extension System
- TypeScript extensions in `~/.pi/agent/extensions/` or `.pi/extensions/`
- Rich event system: `session_start`, `turn_end`, `session_fork`, `session_shutdown`, etc.
- Token usage available via `AssistantMessage.usage`
- Session ID via `ctx.sessionManager.getSessionId()` (UUID)
- TUI capabilities for interactive configuration
- Provider authentication (Anthropic, OpenAI, etc.) is handled by pi itself - our extension does not interact with this

### Key Discoveries
- Claude Code plugin syncs in real-time on each event (not batched)
- Claude Code plugin ignores compaction events (just continues same session)
- No `parentSessionId` field in OpenSync schema - forks will use title prefix `[Fork::parentId]`
- URL normalization required: `.convex.cloud` → `.convex.site`

## Desired End State

A fully functional pi extension that:

1. **Syncs sessions** - Creates OpenSync sessions on `session_start`, updates on `session_shutdown`
2. **Syncs messages** - Real-time sync of user prompts and assistant responses
3. **Handles forks** - Creates new OpenSync sessions with parent traceability via title
4. **Configurable** - File-based config + environment variables + interactive `/opensync-config` command
5. **Non-intrusive** - Silent failures, optional debug logging, status indicator

### Verification
- Extension loads without errors in pi
- Sessions appear in OpenSync dashboard within seconds of starting
- Messages appear in real-time as conversation progresses
- Forks create new sessions with `[Fork::parentId]` prefix
- `/opensync-config` command allows interactive setup
- All unit tests pass

## What We're NOT Doing

- Integration tests against actual OpenSync API
- TUI rendering tests
- Custom compaction handling (follow Claude Code pattern - ignore)
- Cost calculation (pi already provides `usage.cost.total`)
- Transcript file parsing (pi provides structured data via events)
- OAuth/browser-based authentication for OpenSync (API key only)
- Provider authentication (handled by pi itself)

## Upstream Contributions Needed

After implementation is complete, we need to contribute back to OpenSync:

- **Add "pi" as recognized source** - Currently displays as "opencode" in dashboard
- Other improvements may be identified during testing and real-world usage

These are tracked separately and don't block the extension implementation.

## Implementation Approach

We're building the extension directly in this repository (`pi-sync`). We use pi's hot-reload feature via `/reload` command to test changes in the current session as we build.

```
pi-sync/                        # This repo
├── package.json
├── bun.lock
├── .pi/
│   └── settings.json           # Local pi settings to load extension from ./src
├── src/
│   ├── index.ts                # Extension entry point
│   ├── config.ts               # Configuration management
│   ├── client.ts               # OpenSync API client
│   ├── types.ts                # TypeScript interfaces
│   ├── transform.ts            # Data transformation (pi → OpenSync)
│   └── state.ts                # Session state management
├── tests/
│   ├── config.test.ts
│   ├── transform.test.ts
│   ├── state.test.ts
│   └── client.test.ts
├── docs/                       # Research and plans
└── README.md
```

### Development Workflow

We're developing in the current pi session. After making changes to extension code, run `/reload` to reload the extension.

**Primary approach** (untested): Use `.pi/settings.json` to load extension from `./src`:

**File**: `.pi/settings.json`
```json
{
  "extensions": ["./src"]
}
```

**Fallback approach**: If the settings.json approach doesn't work with `/reload`, symlink the src directory to the project-local auto-discovery location:

```bash
mkdir -p .pi/extensions
ln -s ../../src .pi/extensions/pi-opensync-plugin
```

> **Note**: If we fall back to the symlink approach, remove `.pi/settings.json` and ignore any references to it in subsequent phases. The symlink approach uses pi's native auto-discovery from `.pi/extensions/*/index.ts`.

#### Approach Taken

**Status**: ✅ Fallback approach (symlink) confirmed working

**Approach used**: Symlink approach - `.pi/extensions/pi-opensync-plugin` → `../../src`

**Context/Reasoning**: The primary approach (`.pi/settings.json` with `"extensions": ["./src"]`) did not work - the `/opensync-config` command was not available after `/reload`. Switched to the symlink fallback approach which uses pi's native auto-discovery from `.pi/extensions/*/index.ts`.

### Production Installation

For production use, users will clone/copy to `~/.pi/agent/extensions/pi-opensync-plugin/` where it will be auto-discovered globally.

---

## Implementation Phases

| Phase | Description | File | Status |
|-------|-------------|------|--------|
| 1 | Project Setup & Core Types | [phase01.md](./2026-01-28-pi-sync-extension-phase01.md) | ✅ Complete |
| 2 | Configuration Management | [phase02.md](./2026-01-28-pi-sync-extension-phase02.md) | ✅ Complete |
| 3 | OpenSync API Client | [phase03.md](./2026-01-28-pi-sync-extension-phase03.md) | ✅ Complete |
| 4 | State Management & Data Transformation | [phase04.md](./2026-01-28-pi-sync-extension-phase04.md) | ✅ Complete |
| 5 | Session Lifecycle & Message Event Handlers | [phase05.md](./2026-01-28-pi-sync-extension-phase05.md) | Planned |
| 6 | Interactive Configuration Command | [phase06.md](./2026-01-28-pi-sync-extension-phase06.md) | Planned |
| 7 | Documentation & Polish | [phase07.md](./2026-01-28-pi-sync-extension-phase07.md) | Planned |

---

## Testing Strategy

### Unit Tests

**What to test:**
- Config loading from file and environment variables
- URL normalization (`.convex.cloud` → `.convex.site`)
- Session state creation and updates
- Message ID generation
- Data transformation (pi types → OpenSync payloads)
- Text extraction from message content arrays
- Tool call counting
- Fork title generation

**Test files:**
- `tests/config.test.ts` - Configuration management
- `tests/state.test.ts` - Session state management
- `tests/transform.test.ts` - Data transformation
- `tests/client.test.ts` - API client (with mocked fetch)

### Manual Testing Steps

1. **Basic sync flow:**
   - Start pi with extension and valid config
   - Verify session appears in OpenSync dashboard
   - Send a message, verify it appears
   - Exit pi, verify session shows duration

2. **Fork flow:**
   - Create a session with several messages
   - Use `/fork` to fork the session
   - Verify new session in OpenSync with `[Fork::...]` prefix
   - Verify all messages from before fork are present

3. **Configuration:**
   - Test `/opensync-config` command
   - Test all menu options
   - Verify config file creation/editing

4. **Error handling:**
   - Start with invalid API key
   - Verify error status shown
   - Verify pi continues working normally

## Performance Considerations

- Sync operations are non-blocking (fire and forget with error logging)
- No batching for real-time visibility (matches Claude Code pattern)
- Session state updates sent after each turn may be redundant but ensure dashboard accuracy

## References

- Research: `docs/research/2026-01-28_opensync-plugin-architecture.md`
- Research: `docs/research/2026-01-28_pi-extension-api-deep-dive.md`
- Pi extension docs: `ref/pi-mono/packages/coding-agent/docs/extensions.md`
- Claude Code plugin: `ref/claude-code-sync/src/index.ts`
