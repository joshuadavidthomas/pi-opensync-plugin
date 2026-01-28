import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, getConfigPath } from "./config.js";
import { SyncClient } from "./client.js";
import type { Config } from "./types.js";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();
  
  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null, null);
    return;
  }
  
  if (config.autoSync === false) {
    if (config.debug) {
      console.log("[pi-opensync] Auto-sync disabled in config");
    }
    registerConfigCommand(pi, config, null);
    return;
  }
  
  const client = new SyncClient(config);
  
  if (config.debug) {
    console.log("[pi-opensync] Extension loaded, client initialized");
  }
  
  // Register config command with client for connection testing
  registerConfigCommand(pi, config, client);
  
  // Event handlers will be added in Phase 5
}

function registerConfigCommand(pi: ExtensionAPI, config: Config | null, client: SyncClient | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      
      if (config && client) {
        const action = await ctx.ui.select("OpenSync Configuration", [
          "View current config",
          "Test connection",
          "Show config file path",
        ]);
        
        if (!action) return;
        
        switch (action) {
          case "View current config": {
            ctx.ui.notify(
              `Convex URL: ${config.convexUrl}\n` +
              `API Key: ${config.apiKey.slice(0, 8)}...\n` +
              `Auto Sync: ${config.autoSync !== false}\n` +
              `Sync Tool Calls: ${config.syncToolCalls ?? false}\n` +
              `Sync Thinking: ${config.syncThinking ?? false}\n` +
              `Debug: ${config.debug ?? false}`,
              "info"
            );
            break;
          }
          case "Test connection": {
            ctx.ui.notify("Testing connection...", "info");
            const result = await client.testConnection();
            if (result.success) {
              ctx.ui.notify("Connection successful!", "info");
            } else {
              ctx.ui.notify(`Connection failed: ${result.error}`, "error");
            }
            break;
          }
          case "Show config file path": {
            ctx.ui.notify(`Config file: ${getConfigPath()}`, "info");
            break;
          }
        }
      } else {
        ctx.ui.notify(
          `No config found.\n\nCreate config at:\n${getConfigPath()}\n\nOr set environment variables:\nPI_OPENSYNC_CONVEX_URL\nPI_OPENSYNC_API_KEY`,
          "info"
        );
      }
    },
  });
}
