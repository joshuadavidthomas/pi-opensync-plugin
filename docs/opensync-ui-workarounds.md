# OpenSync UI Workarounds

This document describes workarounds implemented in pi-sync to handle limitations in the OpenSync dashboard UI.

## Summary

Both workarounds are about ensuring content is visible in the OpenSync UI, which has an either/or rendering pattern for `textContent` vs `parts`.

## Issue 1: Text Content Not Rendering with Parts

**Problem:** OpenSync UI (`SessionViewer.tsx`) has an either/or rendering logic:
- If `parts` array exists → render ONLY parts (ignore `textContent`)
- If no `parts` → fallback to `textContent`

This means messages with both text content AND structured parts (tool calls, thinking blocks) only show the parts, hiding the text.

**Example:**
```json
{
  "role": "assistant",
  "textContent": "Perfect! ✅ All tests pass. Now typecheck:",
  "parts": [
    {"type": "tool-call", "content": {"toolName": "bash", ...}}
  ]
}
```
Result: Only the tool call badge is visible, the text "Perfect! ✅ All tests pass..." is hidden.

**Workaround:** When an assistant message has both text content AND tool calls/thinking, we add the text as a `{type: "text", content: "..."}` part at the beginning of the parts array.

```typescript
// In transform.ts
if (textContent && (toolCallParts.length > 0 || thinkingParts.length > 0)) {
  parts.push({
    type: "text",
    content: textContent,
  });
}
```

**Result:**
```json
{
  "role": "assistant",
  "textContent": "Perfect! ✅ All tests pass. Now typecheck:",
  "parts": [
    {"type": "text", "content": "Perfect! ✅ All tests pass. Now typecheck:"},
    {"type": "tool-call", "content": {"toolName": "bash", ...}}
  ]
}
```

Now the UI renders both the text AND the tool call.

**Trade-offs:**
- ✅ Fixes missing text display in UI
- ✅ Text still in `textContent` for backward compatibility
- ⚠️ Text duplicated in payload (once in `textContent`, once in `parts`)
- ⚠️ Slightly larger payload size

**Upstream Fix Needed:** OpenSync `SessionViewer.tsx` should render BOTH `textContent` AND `parts`, not either/or:

```typescript
// Current (broken):
{showFallback ? (
  <div>{message.textContent}</div>
) : (
  message.parts?.map(part => <PartRenderer part={part} />)
)}

// Proposed fix:
<>
  {message.textContent && !message.parts?.some(p => p.type === "text") && (
    <div>{message.textContent}</div>
  )}
  {message.parts?.map(part => <PartRenderer part={part} />)}
</>
```

## Issue 2: Tool Results as Separate Messages

**Problem:** Initially, we synced tool results as separate messages with `role: "tool"`. This caused them to appear as separate message bubbles below the assistant's response in the UI, breaking the visual grouping of a single "turn".

**Example (old approach):**
```
Assistant: "Let me read that file" [tool call badge]

↓ (separate bubble)

Tool result: "file contents here"
```

**Solution:** Include tool results as parts of the assistant message instead of separate messages. This matches Claude Code plugin behavior and keeps the turn grouped together.

```typescript
// In index.ts turn_end handler
const toolResults = (config.syncToolCalls !== false) ? event.toolResults : [];
const payload = transformAssistantMessage(
  state.externalId,
  messageId,
  assistantMsg,
  config.syncThinking,
  toolResults  // Pass tool results to be included as parts
);
```

**Result:**
```json
{
  "role": "assistant",
  "textContent": "Let me read that file",
  "parts": [
    {"type": "text", "content": "Let me read that file"},
    {"type": "tool-call", "content": {"toolName": "read", ...}},
    {"type": "tool-result", "content": "file contents here"}
  ]
}
```

Now everything appears in one message bubble! ✅

**Related Files:**
- Implementation: `src/index.ts` (turn_end handler), `src/transform.ts` (transformAssistantMessage, extractToolResultParts)
- Tests: `tests/transform.test.ts`

## Issue 3: Thinking Parts Not Rendering

**Problem:** OpenSync UI doesn't have a renderer for `{type: "thinking"}` parts.

**Status:** Documented in `docs/message-types-verification.md`. Currently syncing correctly, but UI doesn't display them.

**Workaround:** None yet. Thinking content appears in `textContent` as `<thinking>...</thinking>` tags as fallback.

**Upstream Fix Needed:** Add thinking part renderer:

```typescript
if (part.type === "thinking") {
  return (
    <details className="my-2 p-3 rounded bg-muted border border-border">
      <summary className="cursor-pointer font-medium text-sm text-muted-foreground">
        💭 Reasoning
      </summary>
      <div className="mt-2 prose prose-sm dark:prose-invert text-muted-foreground">
        <ReactMarkdown>{part.content}</ReactMarkdown>
      </div>
    </details>
  );
}
```

## Issue 4: Missing "pi" Source Display

**Problem:** OpenSync doesn't recognize "pi" as a source, displays as "opencode" instead.

**Status:** Cosmetic issue, does not affect functionality.

**Upstream Fix Needed:** Add "pi" to source recognition in OpenSync.

---

**Related Files:**
- Implementation: `src/transform.ts` (line ~230)
- Tests: `tests/transform.test.ts` (test cases updated with workaround comments)
- Verification: `docs/message-types-verification.md`
