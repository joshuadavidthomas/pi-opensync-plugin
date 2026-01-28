# Test: Session Shutdown

## Objective
Verify that session duration is recorded when pi session ends.

## Prerequisites
- pi running with extension loaded
- Debug mode enabled: `PI_OPENSYNC_DEBUG=true`
- Active session with some messages

## Steps

1. **Before exiting, note the current session ID:**
   ```bash
   tail -1 .pi/opensync-debug.jsonl | jq -r '.payload.externalId // .sessionId'
   ```

2. **Exit pi session:**
   ```bash
   # In pi, type one of:
   exit
   /exit
   # Or press: Ctrl+D or Ctrl+C
   ```

3. **Check the debug log for shutdown event:**
   ```bash
   cat .pi/opensync-debug.jsonl | jq 'select(.type == "session_shutdown")'
   ```
   
   **Expected:**
   ```json
   {
     "timestamp": "2026-01-28T20:XX:XX.XXXZ",
     "type": "session_shutdown",
     "sessionId": "686047f4-ab84-4be0-b25e-6e2f61af746f"
   }
   ```

4. **Check the final session sync includes duration:**
   ```bash
   cat .pi/opensync-debug.jsonl | \
     jq 'select(.type == "request" and .endpoint == "/sync/session") | .payload.durationMs' | \
     tail -1
   ```
   
   **Expected:** A number (milliseconds since session start)
   
   Example: `125340` (about 2 minutes)

5. **Verify the final sync succeeded:**
   ```bash
   cat .pi/opensync-debug.jsonl | tail -2 | jq 'select(.type == "success")'
   ```
   
   **Expected:**
   ```json
   {
     "timestamp": "...",
     "type": "success",
     "endpoint": "/sync/session",
     "response": {"ok": true, "sessionId": "..."}
   }
   ```

## Success Criteria

- [ ] `session_shutdown` log entry appears
- [ ] Final session sync includes `durationMs` field
- [ ] Duration value is reasonable (> 0, not absurdly large)
- [ ] Final sync returns `{"ok": true}`
- [ ] OpenSync dashboard shows session with duration recorded

## Troubleshooting

### No shutdown event logged
- Check if debug mode is enabled
- Session might have crashed instead of clean shutdown
- Try again with fresh session

### Duration is 0 or missing
- Bug in implementation - session might not have state
- Check earlier logs to confirm session_start happened

### Can't exit pi
Try:
- `Ctrl+C` twice
- `Ctrl+D`
- Kill the process: `pkill -f pi`
