import { appendFileSync } from "node:fs";

const DEBUG_LOG_FILE = ".pi/opensync-debug.jsonl";

export function debugLog(entry: Record<string, unknown>): void {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    appendFileSync(DEBUG_LOG_FILE, JSON.stringify(logEntry) + "\n");
  } catch (error) {
    // Silently fail if we can't write logs
  }
}
