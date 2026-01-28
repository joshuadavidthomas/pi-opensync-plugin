# Phase 6: Interactive Configuration Command

## Overview
Enhance the `/opensync-config` command with full TUI for interactive setup, editing, and clearing config.

## Changes Required:

### 1. Enhanced Config Command
**File**: `src/index.ts` (replace the `registerConfigCommand` function)

```typescript
function registerConfigCommand(pi: ExtensionAPI, currentConfig: Config | null, client: SyncClient | null) {
  pi.registerCommand("opensync-config", {
    description: "Configure OpenSync sync settings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Config command requires interactive mode", "error");
        return;
      }
      
      // Build menu options based on current state
      const menuOptions: string[] = currentConfig
        ? [
            "View current config",
            "Edit config",
            "Test connection",
            "Clear config",
            "Show config file path",
          ]
        : [
            "Set up new config",
            "Show config file path",
          ];
      
      const action = await ctx.ui.select("OpenSync Configuration", menuOptions);
      
      if (!action) return;
      
      switch (action) {
        case "View current config": {
          if (currentConfig) {
            const info = [
              `Convex URL: ${currentConfig.convexUrl}`,
              `API Key: ${currentConfig.apiKey.slice(0, 8)}...`,
              `Auto Sync: ${currentConfig.autoSync !== false}`,
              `Sync Tool Calls: ${currentConfig.syncToolCalls ?? false}`,
              `Sync Thinking: ${currentConfig.syncThinking ?? false}`,
              `Debug: ${currentConfig.debug ?? false}`,
            ].join("\n");
            ctx.ui.notify(info, "info");
          }
          break;
        }
        
        case "Set up new config":
        case "Edit config": {
          // Get Convex URL
          const defaultUrl = currentConfig?.convexUrl ?? "";
          const convexUrl = await ctx.ui.input(
            "OpenSync Convex URL",
            defaultUrl || "https://your-app.convex.cloud"
          );
          
          if (!convexUrl) {
            ctx.ui.notify("Setup cancelled", "info");
            return;
          }
          
          // Get API Key
          const apiKey = await ctx.ui.input(
            "OpenSync API Key",
            currentConfig?.apiKey ?? "osk_"
          );
          
          if (!apiKey) {
            ctx.ui.notify("Setup cancelled", "info");
            return;
          }
          
          // Toggle options
          const options = await ctx.ui.select("Configure options", [
            "Use defaults and save",
            "Configure advanced options",
          ]);
          
          let autoSync = currentConfig?.autoSync ?? true;
          let syncToolCalls = currentConfig?.syncToolCalls ?? false;
          let syncThinking = currentConfig?.syncThinking ?? false;
          let debug = currentConfig?.debug ?? false;
          
          if (options === "Configure advanced options") {
            autoSync = await ctx.ui.confirm("Auto Sync", "Enable automatic session syncing?") ?? true;
            syncToolCalls = await ctx.ui.confirm("Sync Tool Calls", "Sync tool calls as separate messages?") ?? false;
            syncThinking = await ctx.ui.confirm("Sync Thinking", "Include thinking/reasoning in messages?") ?? false;
            debug = await ctx.ui.confirm("Debug Mode", "Enable debug logging?") ?? false;
          }
          
          const newConfig: Config = {
            convexUrl,
            apiKey,
            autoSync,
            syncToolCalls,
            syncThinking,
            debug,
          };
          
          // Test connection before saving
          const testClient = new SyncClient({
            ...newConfig,
            convexUrl: newConfig.convexUrl.replace(".convex.cloud", ".convex.site"),
          });
          const testResult = await testClient.testConnection();
          
          if (!testResult.success) {
            const proceed = await ctx.ui.confirm(
              "Connection Failed",
              `Could not connect: ${testResult.error}\n\nSave config anyway?`
            );
            if (!proceed) {
              ctx.ui.notify("Setup cancelled", "info");
              return;
            }
          }
          
          // Save config
          try {
            saveConfig(newConfig);
            ctx.ui.notify(
              `Config saved to ${getConfigPath()}\n\nRestart pi or use /reload to apply changes.`,
              "info"
            );
          } catch (error) {
            ctx.ui.notify(`Failed to save config: ${error}`, "error");
          }
          break;
        }
        
        case "Test connection": {
          if (!client) return;
          
          ctx.ui.notify("Testing connection...", "info");
          const result = await client.testConnection();
          
          if (result.success) {
            ctx.ui.notify("Connection successful!", "info");
          } else {
            ctx.ui.notify(`Connection failed: ${result.error}`, "error");
          }
          break;
        }
        
        case "Clear config": {
          const confirmed = await ctx.ui.confirm(
            "Clear Config",
            "This will remove your OpenSync configuration. Continue?"
          );
          
          if (confirmed) {
            clearConfig();
            ctx.ui.notify("Config cleared. Restart pi or use /reload to apply changes.", "info");
          }
          break;
        }
        
        case "Show config file path": {
          ctx.ui.notify(`Config file: ${getConfigPath()}`, "info");
          break;
        }
      }
    },
  });
}
```

## Success Criteria:

### Automated Verification:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

### Manual Verification:
- [ ] `/opensync-config` shows appropriate menu (setup vs edit based on config existence)
- [ ] Can set up new config interactively with URL and API key prompts
- [ ] Can configure advanced options (autoSync, syncToolCalls, etc.)
- [ ] Connection test runs before saving and warns on failure
- [ ] Can view current config
- [ ] Can clear config
- [ ] Config file is created at `~/.config/pi-opensync-plugin/config.json`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

### Commit Checkpoint:
After all verifications pass, commit with message:
```
Add interactive configuration command
```
