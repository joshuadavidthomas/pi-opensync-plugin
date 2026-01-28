# OpenSync UI Workarounds

This document describes workarounds implemented in pi-sync to handle limitations in the OpenSync dashboard UI.

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

## Issue 2: Thinking Parts Not Rendering

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

## Issue 3: Missing "pi" Source Display

**Problem:** OpenSync doesn't recognize "pi" as a source, displays as "opencode" instead.

**Status:** Cosmetic issue, does not affect functionality.

**Upstream Fix Needed:** Add "pi" to source recognition in OpenSync.

---

**Related Files:**
- Implementation: `src/transform.ts` (line ~230)
- Tests: `tests/transform.test.ts` (test cases updated with workaround comments)
- Verification: `docs/message-types-verification.md`
