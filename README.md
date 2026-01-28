# pi-opensync-plugin

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that syncs sessions to [OpenSync](https://opensync.dev) dashboards.

## Installation

1. Clone or copy this extension to your pi extensions directory:
   ```bash
   git clone https://github.com/joshuadavidthomas/pi-sync ~/.pi/agent/extensions/pi-opensync-plugin
   cd ~/.pi/agent/extensions/pi-opensync-plugin
   bun install
   ```

2. Configure the extension (see Configuration below)

3. Restart pi - the extension will load automatically

## Configuration

### Interactive Setup

Run `/opensync:config` in pi to interactively configure the extension.

### Manual Configuration

Create `~/.config/pi-opensync-plugin/config.json`:

```json
{
  "convexUrl": "https://your-opensync-deployment.convex.cloud",
  "apiKey": "osk_your_api_key_here",
  "autoSync": true,
  "syncToolCalls": false,
  "syncThinking": false,
  "debug": false
}
```

### Environment Variables

You can also configure via environment variables (takes precedence over config file):

```bash
export PI_OPENSYNC_CONVEX_URL="https://your-opensync-deployment.convex.cloud"
export PI_OPENSYNC_API_KEY="osk_your_api_key_here"
export PI_OPENSYNC_AUTO_SYNC="true"
export PI_OPENSYNC_TOOL_CALLS="false"
export PI_OPENSYNC_THINKING="false"
export PI_OPENSYNC_DEBUG="false"
```

## Features

- **Real-time sync**: Sessions and messages sync as you work
- **Fork support**: Forked sessions create new OpenSync sessions with `[Fork::parentId]` prefix
- **Configurable**: Choose what to sync (tool calls, thinking content)
- **Non-intrusive**: Silent failures, optional debug logging
- **Status indicator**: Shows sync status in pi's footer

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `convexUrl` | (required) | OpenSync Convex deployment URL |
| `apiKey` | (required) | Your OpenSync API key (osk_...) |
| `autoSync` | `true` | Enable automatic session syncing |
| `syncToolCalls` | `false` | Sync tool calls as separate messages |
| `syncThinking` | `false` | Include thinking/reasoning in messages |
| `debug` | `false` | Enable debug logging |

## Commands

- `/opensync:config` - Interactive configuration setup

## How It Works

The extension listens to pi's lifecycle events and syncs data to OpenSync:

1. **Session Start**: Creates a new session in OpenSync with project info
2. **User Input**: Syncs each user message in real-time
3. **Assistant Response**: Syncs assistant messages with token usage
4. **Session End**: Finalizes the session with duration and totals

### Fork Handling

When you fork a session in pi (`/fork`), the extension:
1. Creates a new OpenSync session with title prefix `[Fork::parentId]`
2. Batch-syncs all existing messages from the fork point
3. Continues real-time syncing for new messages

This means forked sessions contain the complete conversation history, which is intentional for traceability.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Type check
bun run typecheck
```

### Hot-Reload Workflow

The project includes `.pi/extensions/` symlink which enables hot-reloading during development:

```bash
# Make changes to src/*.ts files
# Then in pi, run:
/reload

# The extension will reload with your changes
```

If developing in a fresh pi session, just start pi from the project directory and the extension will auto-load.

## Compatibility

- Requires pi coding agent >= 0.50.0
- Tested with OpenSync API

## License

MIT
