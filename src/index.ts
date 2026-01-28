import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, getConfigPath } from "./config.js";
import type { Config } from "./types.js";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  const config = loadConfig();
  
  if (!config) {
    // Not configured - register config command only
    registerConfigCommand(pi, null);
    return;
  }
  
  if (config.autoSync === false) {
    if (config.debug) {
      console.log("[pi-opensync] Auto-sync disabled in config");
    }
    registerConfigCommand(pi, config);
    return;
  }
  
  if (config.debug) {
    console.log("[pi-opensync] Extension loaded with config");
  }
  
  // Register config command
  registerConfigCommand(pi, config);
  
  // Event handlers will be added in Phase 5
}

function registerConfigCommand(pi: ExtensionAPI, config: Config | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (config) {
        ctx.ui.notify(
          `Config loaded from: ${getConfigPath()}\nConvex URL: ${config.convexUrl}\nAPI Key: ${config.apiKey.slice(0, 8)}...`,
          "info"
        );
      } else {
        ctx.ui.notify(
          `No config found.\nCreate config at: ${getConfigPath()}\nOr set PI_OPENSYNC_CONVEX_URL and PI_OPENSYNC_API_KEY env vars.`,
          "info"
        );
      }
    },
  });
}
