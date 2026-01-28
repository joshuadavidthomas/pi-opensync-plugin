/**
 * OpenSync configuration selector component
 */

import {
  Container,
  Text,
  Spacer,
  Input,
  getEditorKeybindings,
  SettingsList,
  type SettingItem,
} from "@mariozechner/pi-tui";
import { getSettingsListTheme, DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Config } from "../types.js";
import { saveConfig, getConfigPath } from "./index.js";
import { SyncClient } from "../client.js";

export interface ConfigSelectorCallbacks {
  onClose: () => void;
  requestRender: () => void;
}

/**
 * Helper to create a text input submenu for SettingsList
 */
function createTextInputSubmenu(
  title: string,
  description: string,
  initialValue: string,
  onSave: (value: string) => void,
  onCancel: () => void
) {
  
  const container = new Container();
  const input = new Input();
  input.setValue(initialValue);
  
  container.addChild(new Spacer(1));
  container.addChild(new Text(title, 1, 0));
  if (description) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(description, 1, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(input);
  container.addChild(new Spacer(1));
  container.addChild(new Text("enter to save • esc to cancel", 1, 0));
  container.addChild(new Spacer(1));
  
  let isFocused = false;
  
  return {
    render(width: number) {
      return container.render(width);
    },
    invalidate() {
      container.invalidate();
    },
    handleInput(data: string) {
      const kb = getEditorKeybindings();
      if (kb.matches(data, "selectConfirm") || data === "\n") {
        const value = input.getValue().trim();
        if (value) {
          onSave(value);
        } else {
          onCancel();
        }
      } else if (kb.matches(data, "selectCancel")) {
        onCancel();
      } else {
        input.handleInput(data);
      }
    },
    get focused() {
      return isFocused;
    },
    set focused(value: boolean) {
      isFocused = value;
      input.focused = value;
    },
  };
}

export class ConfigSelectorComponent {
  private container: typeof Container.prototype;
  private settingsList: typeof SettingsList.prototype;
  private ctx: ExtensionContext;
  
  // Config state
  private convexUrl: string;
  private apiKey: string;
  private autoSync: boolean;
  private syncToolCalls: boolean;
  private syncThinking: boolean;
  private debug: boolean;
  
  constructor(
    currentConfig: Config | null,
    ctx: ExtensionContext,
    callbacks: ConfigSelectorCallbacks
  ) {
    this.ctx = ctx;
    
    // Initialize config state from current or defaults
    this.convexUrl = currentConfig?.convexUrl ?? "https://your-app.convex.cloud";
    this.apiKey = currentConfig?.apiKey ?? "osk_";
    this.autoSync = currentConfig?.autoSync ?? true;
    this.syncToolCalls = currentConfig?.syncToolCalls !== false; // defaults to true
    this.syncThinking = currentConfig?.syncThinking ?? false;
    this.debug = currentConfig?.debug ?? false;
    
    // Build settings items
    const items: SettingItem[] = [
      {
        id: "convex-url",
        label: "Convex URL",
        description: "Your OpenSync Convex deployment URL",
        currentValue: this.convexUrl,
        submenu: (current, done) => {
          return createTextInputSubmenu(
            "Convex URL",
            "Enter your OpenSync Convex URL",
            current,
            (value) => {
              this.convexUrl = value;
              done(value);
            },
            () => done()
          );
        },
      },
      {
        id: "api-key",
        label: "API Key",
        description: "Your OpenSync API key (osk_...)",
        currentValue: this.apiKey.slice(0, 12) + "...",
        submenu: (_current, done) => {
          return createTextInputSubmenu(
            "API Key",
            "Enter your OpenSync API key",
            this.apiKey, // Use full key for editing (not the truncated '_current')
            (value) => {
              this.apiKey = value;
              done(value.slice(0, 12) + "...");
            },
            () => done()
          );
        },
      },
      {
        id: "auto-sync",
        label: "Auto Sync",
        description: "Automatically sync sessions to OpenSync",
        currentValue: this.autoSync ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "sync-tool-calls",
        label: "Sync Tool Calls",
        description: "Include tool calls and results in synced messages",
        currentValue: this.syncToolCalls ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "sync-thinking",
        label: "Sync Thinking",
        description: "Include model reasoning/thinking in messages",
        currentValue: this.syncThinking ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "debug",
        label: "Debug Mode",
        description: "Enable debug logging",
        currentValue: this.debug ? "true" : "false",
        values: ["true", "false"],
      },
    ];
    
    // Build component tree
    this.container = new Container();
    this.container.addChild(new DynamicBorder((s: string) => s));
    
    this.settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id: string, newValue: string) => {
        this.handleValueChange(id, newValue);
      },
      async () => {
        await this.handleClose(callbacks.onClose);
      },
      { enableSearch: true }
    );
    
    this.container.addChild(this.settingsList);
    this.container.addChild(new DynamicBorder((s: string) => s));
  }
  
  private handleValueChange(id: string, newValue: string): void {
    switch (id) {
      case "auto-sync":
        this.autoSync = newValue === "true";
        break;
      case "sync-tool-calls":
        this.syncToolCalls = newValue === "true";
        break;
      case "sync-thinking":
        this.syncThinking = newValue === "true";
        break;
      case "debug":
        this.debug = newValue === "true";
        break;
    }
  }
  
  private async handleClose(onClose: () => void): Promise<void> {
    // Prompt to save
    const save = await this.ctx.ui.confirm(
      "Save Configuration",
      "Save changes to OpenSync configuration?"
    );
    
    if (!save) {
      onClose();
      return;
    }
    
    const newConfig: Config = {
      convexUrl: this.convexUrl,
      apiKey: this.apiKey,
      autoSync: this.autoSync,
      syncToolCalls: this.syncToolCalls,
      syncThinking: this.syncThinking,
      debug: this.debug,
    };
    
    // Test connection
    const testClient = new SyncClient({
      ...newConfig,
      convexUrl: newConfig.convexUrl.replace(".convex.cloud", ".convex.site"),
    });
    const testResult = await testClient.testConnection();
    
    if (!testResult.success) {
      const proceed = await this.ctx.ui.confirm(
        "Connection Failed",
        `Could not connect: ${testResult.error}\n\nSave anyway?`
      );
      if (!proceed) {
        this.ctx.ui.notify("Configuration not saved", "info");
        onClose();
        return;
      }
    }
    
    // Save
    try {
      saveConfig(newConfig);
      this.ctx.ui.notify(
        `Config saved to ${getConfigPath()}\n\nRestart pi or use /reload to apply changes.`,
        "info"
      );
    } catch (error) {
      this.ctx.ui.notify(`Failed to save config: ${error}`, "error");
    }
    
    onClose();
  }
  
  render(width: number): string[] {
    return this.container.render(width);
  }
  
  invalidate(): void {
    this.container.invalidate();
  }
  
  handleInput(data: string): void {
    this.settingsList.handleInput?.(data);
  }
}
