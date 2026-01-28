import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function piOpensyncPlugin(pi: ExtensionAPI) {
  // Phase 1: Minimal skeleton
  // Configuration, client, and event handlers will be added in subsequent phases
  
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-opensync-plugin loaded! Config not yet implemented.", "info");
    },
  });
}
