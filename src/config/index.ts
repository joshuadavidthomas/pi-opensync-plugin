import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "../types";

const CONFIG_DIR = join(homedir(), ".config", "pi-opensync-plugin");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Normalize Convex URL to use .convex.site for HTTP endpoints
 */
export function normalizeConvexUrl(url: string): string {
  return url.replace(".convex.cloud", ".convex.site");
}

/**
 * Load configuration from environment variables or config file
 * Environment variables take precedence
 */
export function loadConfig(): Config | null {
  // Check environment variables first
  const envUrl = process.env.PI_OPENSYNC_CONVEX_URL;
  const envKey = process.env.PI_OPENSYNC_API_KEY;
  
  if (envUrl && envKey) {
    return {
      convexUrl: normalizeConvexUrl(envUrl),
      apiKey: envKey,
      autoSync: process.env.PI_OPENSYNC_AUTO_SYNC !== "false",
      syncToolCalls: process.env.PI_OPENSYNC_TOOL_CALLS !== "false",
      syncThinking: process.env.PI_OPENSYNC_THINKING === "true",
      debug: process.env.PI_OPENSYNC_DEBUG === "true",
    };
  }
  
  // Fall back to config file
  return loadConfigFile();
}

/**
 * Load configuration from file only
 */
export function loadConfigFile(): Config | null {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(data) as Config;
      config.convexUrl = normalizeConvexUrl(config.convexUrl);
      return config;
    }
  } catch (error) {
    console.error("[pi-opensync] Error loading config:", error);
  }
  return null;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
