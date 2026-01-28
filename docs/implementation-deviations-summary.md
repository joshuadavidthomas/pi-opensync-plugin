# Implementation Deviations Summary

This document summarizes how the actual implementation of pi-sync deviated from the original phase plans. These notes have been added to the individual phase plan documents for reference.

## Phase 1: Types & Project Setup

### MessagePayload Structure Changed
- **Planned:** Simple `textContent` field only
- **Actual:** Added `parts?: MessagePart[]` field for structured content
- **Impact:** Enables tool calls, tool results, and thinking blocks as structured parts
- **Files:** `src/types.ts`

### MessagePart Interface Added
- **Planned:** Not in original types
- **Actual:** New interface with `type: string` and `content: unknown` fields
- **Reason:** Required to represent structured parts in OpenSync API
- **Files:** `src/types.ts`

### Config syncToolCalls Default Changed
- **Planned:** `default: false` (opt-in)
- **Actual:** `default: true` (opt-out)
- **Reason:** Tool results are now parts of assistant messages, not separate messages, so syncing by default provides better UX
- **Files:** `src/types.ts`

## Phase 2: Configuration Management

**No significant deviations** - Implemented as planned with env var support and file-based config.

## Phase 3: OpenSync API Client

**No significant deviations** - Implemented as planned with POST endpoints, Bearer auth, and health checks.

## Phase 4: State & Transformation

### Additional Transform Functions
**Added functions not in original plan:**
- `extractToolCallParts()` - Extracts tool calls as structured MessagePart[]
- `extractThinkingParts()` - Extracts thinking blocks as structured MessagePart[]
- `extractToolResultParts()` - Extracts tool results as structured MessagePart[]

**Reason:** These are needed to build the `parts` array added to MessagePayload in Phase 1.

**Files:** `src/transform.ts`

### Tool Results as Parts, Not Messages
- **Planned:** `transformToolResultMessage()` function to create separate messages with `role: "tool"`
- **Actual:** Tool results included as parts of assistant messages instead
- **Reason:** OpenSync UI groups messages into separate bubbles. Including results as parts keeps the entire "turn" (assistant response + tool calls + results) visually grouped in one bubble
- **Impact:** Removed `transformToolResultMessage()` function, added `toolResults` parameter to `transformAssistantMessage()`
- **Files:** `src/transform.ts`
- **Reference:** Claude Code plugin uses the same pattern

### Session Title Always Has Value
- **Planned:** `generateSessionTitle()` returns `undefined` when no session name
- **Actual:** Returns `"Untitled"` as fallback
- **Reason:** Matches pi's UI behavior, ensures fork sessions have meaningful titles like `[Fork::abc123] Untitled`
- **Files:** `src/transform.ts`

### Text Content Workaround
**Not in original plan:** When messages have both text content AND tool calls/thinking, the text is duplicated as a `{type: "text", content: "..."}` part.

**Reason:** OpenSync UI renders either `textContent` OR `parts`, not both. Without this workaround, text disappears when tool calls are present.

**Example:**
```json
{
  "textContent": "Let me read that file",
  "parts": [
    {"type": "text", "content": "Let me read that file"},  // ← Workaround
    {"type": "tool-call", "content": {"toolName": "read", ...}}
  ]
}
```

**Files:** `src/transform.ts`, `tests/transform.test.ts`

**Documentation:** `docs/opensync-ui-workarounds.md`

### ThinkingContent Property Name
- **Planned:** `type: "thinking"; text: string`
- **Actual:** `type: "thinking"; thinking: string`
- **Reason:** Matches actual pi-ai types (property is named `thinking`, not `text`)
- **Files:** `src/transform.ts`

## Phase 5: Event Handlers

### Session Resume Support Added
**Not in original plan:** On `session_start`, check if session already exists in OpenSync and restore message count to prevent duplicate IDs.

**Scenario:** User runs `/resume` to continue a previous session. Without this, message IDs would restart at 0, causing conflicts.

**Implementation:** Query existing messages, restore `messageCount` to highest value found.

**Files:** `src/index.ts` (lines 64-102)

**Tests:** `tests/index.test.ts` (session resume test case)

### Fork Title Includes "Untitled"
- **Original behavior:** Fork sessions without a name got title `[Fork::abc123]`
- **Actual:** Fork sessions without a name get title `[Fork::abc123] Untitled`
- **Reason:** More informative, matches pi's default session naming
- **Files:** `src/transform.ts` (generateSessionTitle)

## Key Architectural Decisions

### 1. Tool Results as Parts
The most significant deviation was changing tool results from separate messages to parts of assistant messages. This was discovered during testing when we saw each tool result appearing in a separate message bubble, fragmenting the conversation flow.

**Before (planned):**
```
[Assistant bubble]: "Let me read that file" [tool call badge]

[Tool result bubble]: "file contents here"
```

**After (implemented):**
```
[Assistant bubble]: 
  "Let me read that file"
  [tool call badge]
  [tool result badge]
```

This matches the Claude Code plugin pattern and provides better UX in the OpenSync dashboard.

### 2. Tool Calls and Results Interleaving
**Post-Phase 5 fix:** Initial implementation concatenated all tool calls followed by all tool results, making it hard to match calls with their results in the UI.

**Problem discovered:** When messages had multiple tool calls (e.g., 4 reads), users saw all 4 tool call badges first, then had to scroll down to find the result of the first call.

**Solution implemented:** Modified `transformAssistantMessage()` to iterate through content and interleave each tool call with its corresponding result immediately after:

**Before (initial implementation):**
```json
"parts": [
  {"type": "tool-call", ...},  // call 1
  {"type": "tool-call", ...},  // call 2
  {"type": "tool-call", ...},  // call 3
  {"type": "tool-call", ...},  // call 4
  {"type": "tool-result", ...}, // result 1
  {"type": "tool-result", ...}, // result 2
  {"type": "tool-result", ...}, // result 3
  {"type": "tool-result", ...}  // result 4
]
```

**After (fixed):**
```json
"parts": [
  {"type": "tool-call", ...},   // call 1
  {"type": "tool-result", ...},  // result 1
  {"type": "tool-call", ...},   // call 2
  {"type": "tool-result", ...},  // result 2
  {"type": "tool-call", ...},   // call 3
  {"type": "tool-result", ...},  // result 3
  {"type": "tool-call", ...},   // call 4
  {"type": "tool-result", ...}   // result 4
]
```

**Files:** `src/transform.ts`, `tests/transform.test.ts`

**Documentation:** `docs/tool-call-result-interleaving-fix.md`

### 3. OpenSync UI Workarounds
We discovered and documented two UI limitations in OpenSync that required workarounds:

1. **Either/or rendering:** UI renders either `textContent` OR `parts`, not both
   - **Workaround:** Include text as a part when other parts exist
   
2. **Missing thinking renderer:** UI doesn't render `{type: "thinking"}` parts
   - **Status:** Documented for upstream contribution

See `docs/opensync-ui-workarounds.md` for technical details and proposed upstream fixes.

### 4. Session Resume Support
Not explicitly planned but necessary for robust session handling. Without this, users who resume sessions would see duplicate message ID errors.

## Files Modified Beyond Original Plan

**New files created:**
- `docs/opensync-ui-workarounds.md` - Documents UI limitations and workarounds
- `docs/phase05-completion-summary.md` - Phase 5 completion report
- `docs/implementation-deviations-summary.md` - This file

**Significantly expanded files:**
- `src/transform.ts` - Added 3 new extraction functions, modified transformAssistantMessage
- `src/index.ts` - Added session resume logic in session_start handler

## Testing Impact

All changes were covered by tests:
- ✅ 50 tests pass (0 fail)
- ✅ 128 expect() calls
- ✅ All message transformation cases covered
- ✅ Session resume scenario tested
- ✅ Fork title generation tested
- ✅ Text part workaround tested

## Documentation Impact

Created comprehensive documentation for deviations:
1. Implementation notes added to each phase plan document
2. `opensync-ui-workarounds.md` for technical details
3. This summary document for high-level overview

## Phase 6: Interactive Configuration Command

### Component Architecture Change
- **Planned:** Sequential prompts using `ctx.ui.select()` → `ctx.ui.input()` flow
- **Actual:** Single unified settings screen using `SettingsList` component
- **Reason:** `ctx.ui.input()` doesn't support pre-filled default values (only placeholder text)
- **Solution:** Used pi's native `SettingsList` with text input submenus for editable fields
- **Files:** `src/config/selector.ts` (new), `src/index.ts`

### Module Reorganization
**Not in plan:** Created `src/config/` module structure
- Moved `src/config.ts` → `src/config/index.ts`
- Created `src/config/selector.ts` for UI component
- Abstracted config UI into `ConfigSelectorComponent` class
- **Reason:** Better code organization, follows pi's component patterns
- **Reference:** `ref/pi-mono/packages/coding-agent/src/modes/interactive/components/settings-selector.ts`

### Removed Features from Plan
Several menu options from the original plan were removed:
- ❌ "View current config" - Not needed, all visible in settings list
- ❌ "Test connection" - Runs automatically before save
- ❌ "Clear config" - Can add later if needed
- ❌ "Show config file path" - Can add later if needed

### Configuration Flow Change
- **Planned:** Sequential: URL prompt → API key prompt → options prompt → save
- **Actual:** Single screen with all options visible, edit any field, save on exit
- **Benefit:** Users see all config at once, consistent with pi's `/settings` command

### Default Value Bug Fix
**Discovered during implementation:** `syncToolCalls` default value inconsistency
- Runtime code defaulted to `true` when undefined
- Initial UI implementation showed `false` when undefined
- **Fix:** Changed UI default from `?? false` to `!== false` to match runtime behavior
- **Files:** `src/config/selector.ts`

### Import Organization
**Not in plan but enforced:** Moved all dynamic imports to top-level
- Removed all `require()` calls from helper functions
- Removed all `await import()` from handlers and tests
- Applied to both `src/` and `tests/` directories
- **Reason:** Code quality, static analysis benefits, follows ES module best practices

## Upstream Contributions Identified

Issues that should be contributed back to OpenSync:
1. UI should render both `textContent` AND `parts` (not either/or)
2. Add thinking part renderer component
3. Add "pi" source recognition (cosmetic)

Detailed technical proposals in `docs/opensync-ui-workarounds.md`.
