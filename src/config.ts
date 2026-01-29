import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

const CONFIG_DIR = join(homedir(), ".config", "pi-opensync-plugin");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Configuration interface for pi-opensync-plugin
 */
export interface Config {
  convexUrl: string;
  apiKey: string;
  autoSync: boolean;
  syncToolCalls: boolean;
  syncThinking: boolean;
  debug: boolean;
}

/**
 * Normalize Convex URL to use .convex.site for HTTP endpoints
 */
export function normalizeConvexUrl(url: string): string {
  return url.replace(".convex.cloud", ".convex.site");
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Load configuration from environment variables or config file
 */
export function loadConfig(): Config | null {
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
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        convexUrl: normalizeConvexUrl(parsed.convexUrl ?? ""),
        apiKey: parsed.apiKey ?? "",
        autoSync: parsed.autoSync ?? true,
        syncToolCalls: parsed.syncToolCalls ?? true,
        syncThinking: parsed.syncThinking ?? false,
        debug: parsed.debug ?? false,
      };
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
 * Factory for creating text input submenus compatible with SettingsList.
 * Returns a component that handles text input with enter to save and esc to cancel.
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

/**
 * Callbacks for ConfigSelectorComponent
 */
export interface ConfigSelectorCallbacks {
  onClose: () => void;
  requestRender: () => void;
}

/**
 * Interactive configuration selector component
 */
export class ConfigSelectorComponent {
  private container: typeof Container.prototype;
  private settingsList: typeof SettingsList.prototype;
  private ctx: ExtensionContext;
  private config: Config;
  private testConnection: () => Promise<{ success: boolean; error?: string }>;

  constructor(
    currentConfig: Config | null,
    ctx: ExtensionContext,
    callbacks: ConfigSelectorCallbacks,
    testConnection: () => Promise<{ success: boolean; error?: string }>
  ) {
    this.ctx = ctx;
    this.testConnection = testConnection;
    this.config = currentConfig ?? {
      convexUrl: "https://your-app.convex.cloud",
      apiKey: "osk_",
      autoSync: true,
      syncToolCalls: true,
      syncThinking: false,
      debug: false,
    };

    const items: SettingItem[] = [
      {
        id: "convex-url",
        label: "Convex URL",
        description: "Your OpenSync Convex deployment URL",
        currentValue: this.config.convexUrl,
        submenu: (current, done) => {
          return createTextInputSubmenu(
            "Convex URL",
            "Enter your OpenSync Convex URL",
            current,
            (value) => {
              this.config.convexUrl = value;
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
        currentValue: this.config.apiKey.slice(0, 12) + "...",
        submenu: (_current, done) => {
          return createTextInputSubmenu(
            "API Key",
            "Enter your OpenSync API key",
            this.config.apiKey,
            (value) => {
              this.config.apiKey = value;
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
        currentValue: this.config.autoSync ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "sync-tool-calls",
        label: "Sync Tool Calls",
        description: "Include tool calls and results in synced messages",
        currentValue: this.config.syncToolCalls ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "sync-thinking",
        label: "Sync Thinking",
        description: "Include model reasoning/thinking in messages",
        currentValue: this.config.syncThinking ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "debug",
        label: "Debug Mode",
        description: "Enable debug logging",
        currentValue: this.config.debug ? "true" : "false",
        values: ["true", "false"],
      },
    ];

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
    const boolValue = newValue === "true";
    switch (id) {
      case "auto-sync":
        this.config.autoSync = boolValue;
        break;
      case "sync-tool-calls":
        this.config.syncToolCalls = boolValue;
        break;
      case "sync-thinking":
        this.config.syncThinking = boolValue;
        break;
      case "debug":
        this.config.debug = boolValue;
        break;
    }
  }

  private async handleClose(onClose: () => void): Promise<void> {
    const save = await this.ctx.ui.confirm(
      "Save Configuration",
      "Save changes to OpenSync configuration?"
    );

    if (!save) {
      onClose();
      return;
    }

    const testResult = await this.testConnection();

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

    try {
      saveConfig(this.config);
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
