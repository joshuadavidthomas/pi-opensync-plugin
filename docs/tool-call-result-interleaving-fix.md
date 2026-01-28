# Tool Call and Result Interleaving Fix

**Date:** 2026-01-28  
**Issue:** Tool calls and tool results were not properly interleaved in the parts array  
**Status:** ✅ Fixed

## Problem

When messages contained multiple tool calls, the parts array was structured incorrectly:

```json
{
  "parts": [
    {"type": "text", "content": "..."},
    {"type": "tool-call", "content": {"toolName": "read", ...}},
    {"type": "tool-call", "content": {"toolName": "write", ...}},
    {"type": "tool-call", "content": {"toolName": "bash", ...}},
    {"type": "tool-call", "content": {"toolName": "grep", ...}},
    {"type": "tool-result", "content": "result of read"},
    {"type": "tool-result", "content": "result of write"},
    {"type": "tool-result", "content": "result of bash"},
    {"type": "tool-result", "content": "result of grep"}
  ]
}
```

This caused poor UX in the OpenSync dashboard - users saw all four tool calls first, then had to scroll down to find the result of the first tool call far below.

## Root Cause

The original implementation extracted all tool calls into an array, then all tool results into another array, then concatenated them:

```typescript
// OLD (WRONG)
const toolCallParts = extractToolCallParts(message.content);
const toolResultParts = toolResults.flatMap(result => extractToolResultParts(result));

parts.push(...toolCallParts);
parts.push(...toolResultParts);
```

This resulted in the "all calls, then all results" structure.

## Solution

Modified `transformAssistantMessage()` to iterate through the message content and interleave tool calls with their corresponding results:

```typescript
// NEW (CORRECT)
let resultIndex = 0;
for (const part of message.content) {
  if (part.type === "toolCall") {
    // Add the tool call
    parts.push({
      type: "tool-call",
      content: {
        toolName: part.name,
        args: part.arguments,
      },
    });
    
    // Add the corresponding tool result if it exists
    if (resultIndex < toolResults.length) {
      const result = toolResults[resultIndex];
      const resultParts = extractToolResultParts(result);
      parts.push(...resultParts);
      resultIndex++;
    }
  }
}
```

This produces the correct structure:

```json
{
  "parts": [
    {"type": "text", "content": "..."},
    {"type": "tool-call", "content": {"toolName": "read", ...}},
    {"type": "tool-result", "content": "result of read"},
    {"type": "tool-call", "content": {"toolName": "write", ...}},
    {"type": "tool-result", "content": "result of write"},
    {"type": "tool-call", "content": {"toolName": "bash", ...}},
    {"type": "tool-result", "content": "result of bash"},
    {"type": "tool-call", "content": {"toolName": "grep", ...}},
    {"type": "tool-result", "content": "result of grep"}
  ]
}
```

## Assumption

This fix assumes that tool results arrive in the same order as tool calls:
- Tool call 1 → Tool result 1
- Tool call 2 → Tool result 2
- Tool call 3 → Tool result 3
- etc.

This is consistent with how pi's agent loop executes tools sequentially and how the `turn_end` event provides results.

## Additional Improvements

### Removed Helper Functions

Since we now build parts inline during iteration, we removed:
- `extractToolCallParts()` - No longer needed
- `extractThinkingParts()` - No longer needed

We kept:
- `extractToolResultParts()` - Still used to extract text from tool result content
- `countToolCalls()` - Still used for tracking tool call counts in state

### Two-Pass Processing

The function now uses a two-pass approach:

1. **First pass:** Interleave tool calls with their results
2. **Second pass:** Add thinking blocks (after all tool calls/results)

This ensures the parts array order is:
1. Text (if present)
2. Tool call 1 + result 1
3. Tool call 2 + result 2
4. ...
5. All thinking blocks (if `includeThinking: true`)

## Testing

Added comprehensive test case for interleaving:

```typescript
it("interleaves multiple tool calls with their results", () => {
  // Message with 3 tool calls
  const message = { ... };
  
  // 3 corresponding tool results
  const toolResults = [ ... ];
  
  const payload = transformAssistantMessage(...);
  
  // Verifies: text → call1 → result1 → call2 → result2 → call3 → result3
  expect(payload.parts).toHaveLength(7);
  expect(payload.parts![0].type).toBe("text");
  expect(payload.parts![1].type).toBe("tool-call");
  expect(payload.parts![2].type).toBe("tool-result");
  expect(payload.parts![3].type).toBe("tool-call");
  expect(payload.parts![4].type).toBe("tool-result");
  expect(payload.parts![5].type).toBe("tool-call");
  expect(payload.parts![6].type).toBe("tool-result");
});
```

All tests pass:
- ✅ 46 tests pass (0 fail)
- ✅ 118 expect() calls
- ✅ TypeScript typecheck passes

## Files Modified

- `src/transform.ts` - Rewrote `transformAssistantMessage()`, removed helper functions
- `tests/transform.test.ts` - Removed tests for deleted functions, added interleaving test

## Impact

This fix significantly improves UX in the OpenSync dashboard. Users can now see each tool call immediately followed by its result, making it easy to understand the flow of execution.

**Before:** Confusing - all calls shown first, results far below

**After:** Clear - each call paired with its result
