# Testing Message Types in pi-sync

Quick reference for testing different message types with OpenSync.

## Configuration

Enable all features for testing:
```bash
export PI_OPENSYNC_DEBUG=true
export PI_OPENSYNC_THINKING=true
export PI_OPENSYNC_TOOL_CALLS=true  # default, but explicit
```

## Test Scenarios

### 1. Basic User Message
```
# Just type a message
Hello, world!
```

**Expected:**
- Message syncs with role: "user"
- textContent: "Hello, world!"
- No parts array

### 2. Assistant Response (Text Only)
```
# Ask a simple question
What is 2+2?
```

**Expected:**
- Assistant response with role: "assistant"
- textContent: "4" (or explanation)
- No parts array (unless thinking enabled)

### 3. Assistant with Thinking
```
# Ask something that requires reasoning
How would you implement a binary search tree in TypeScript?
```

**Expected:**
- Assistant message includes:
  ```json
  "parts": [
    {"type": "thinking", "content": "Let me think about..."}
  ]
  ```
- textContent: includes `<thinking>...</thinking>` tags
- ⚠️ Thinking won't render in OpenSync UI (upstream issue)

### 4. Tool Call
```
# Request file operation
Show me the contents of package.json
```

**Expected:**
- Assistant message with tool call:
  ```json
  "parts": [
    {
      "type": "tool-call",
      "content": {
        "toolName": "read",
        "args": {"path": "package.json"}
      }
    }
  ]
  ```
- Tool result as separate message:
  ```json
  {
    "role": "tool",
    "textContent": "[read]\n{...file contents...}",
    "parts": [
      {"type": "tool-result", "content": "{...file contents...}"}
    ]
  }
  ```

### 5. Multiple Tool Calls
```
# Request multiple files
Compare package.json and tsconfig.json
```

**Expected:**
- Assistant message with multiple parts:
  ```json
  "parts": [
    {"type": "tool-call", "content": {"toolName": "read", "args": {...}}},
    {"type": "tool-call", "content": {"toolName": "read", "args": {...}}}
  ]
  ```
- Two separate tool result messages

### 6. Tool Call + Thinking
```
# Complex request requiring reasoning
Analyze the project structure and suggest improvements
```

**Expected:**
- Combined parts:
  ```json
  "parts": [
    {"type": "tool-call", "content": {...}},
    {"type": "thinking", "content": "I should check..."}
  ]
  ```

## Verifying Sync Success

### Check Debug Log
```bash
# Watch live
tail -f .pi/opensync-debug.jsonl | jq .

# Check last 10 entries
tail -10 .pi/opensync-debug.jsonl | jq .

# See only sync results
cat .pi/opensync-debug.jsonl | jq 'select(.type == "success") | .response.ok'
# Should all be: true
```

### Expected Log Pattern
Every synced message should show:
```json
{"type": "request", "endpoint": "/sync/message", "payload": {...}}
{"type": "success", "response": {"ok": true, "messageId": "..."}}
```

If you see `"ok": false` or `"type": "error"`, something is wrong.

## OpenSync UI Verification

### What Should Render
✅ **User messages** - Full text  
✅ **Assistant text** - Regular responses  
✅ **Tool calls** - Shows tool name and args  
✅ **Tool results** - Shows output  

### What Won't Render (Yet)
⚠️ **Thinking blocks** - Requires upstream UI fix  
- Workaround: Check textContent for `<thinking>` tags
- Will show in API/database, just not in UI

### Checking OpenSync Dashboard

1. Open https://opensync.dev
2. Find your session (should be named with project path)
3. Look for:
   - Session metadata (tokens, cost, duration)
   - Message count matches what you sent
   - Tool calls appear as expandable blocks
   - Tool results appear as system messages

## Troubleshooting

### Messages Not Appearing
1. Check debug log - are they syncing?
   ```bash
   cat .pi/opensync-debug.jsonl | jq 'select(.type == "error")'
   ```
2. Verify session ID matches:
   ```bash
   cat .pi/opensync-debug.jsonl | jq -r 'select(.type == "session_start") | .sessionId'
   ```
3. Check OpenSync dashboard - refresh page (UI caching issue)

### Thinking Not Visible
This is expected! OpenSync UI doesn't render thinking parts yet.
- Check API accepted it: `cat .pi/opensync-debug.jsonl | jq '.payload.parts'`
- Should see: `[{"type": "thinking", "content": "..."}]`

### Tool Results Missing
Check config:
```bash
# Should be true (or unset, defaults to true)
echo $PI_OPENSYNC_TOOL_CALLS
```

## Performance Notes

All syncs are:
- **Asynchronous** - don't block the UI
- **Fire-and-forget** - errors logged but don't stop conversation
- **Batched on fork** - initial messages sent together
- **Incremental otherwise** - one message at a time

Debug mode adds ~5-10ms per request for logging.
