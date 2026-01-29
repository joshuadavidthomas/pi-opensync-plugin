# pi-opensync-plugin

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that syncs sessions to [OpenSync](https://opensync.dev) dashboards.

## Requirements

- [pi](https://github.com/badlogic/pi-mono) >= 0.50.0
- [OpenSync](https://github.com/waynesutton/opensync) account ([hosted](https://opensync.dev) or [self-hosted](https://www.opensync.dev/docs#requirements)) and API key

## Features

- **Real-time sync**: Sessions and messages sync as you work
- **Fork support**: Forked sessions create new OpenSync sessions with `[Fork::parentId]` prefix
- **Configurable**: Choose what to sync (tool calls, thinking content)
- **Non-intrusive**: Silent failures, optional debug logging

## Installation

Install as a [pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) globally:

```bash
pi install npm:pi-opensync-plugin
```

For project-local installation (auto-installs for teammates), use the `-l` flag when calling `pi install`:

```bash
pi install -l npm:pi-opensync-plugin
```

To try without installing, pass the `-e` flag to temporarily add it to your extensions for the duration of a session:

```bash
pi -e npm:pi-opensync-plugin
```

For any of the above commands, you can also use the repository URL in place of the NPM package to install:

```bash
pi install git:github.com/joshuadavidthomas/pi-opensync-plugin
# or the full URL
pi install https://github.com/joshuadavidthomas/pi-opensync-plugin
```

For manual installation, clone the repository to any place pi coding agent looks for extensions:

```bash
git clone https://github.com/joshuadavidthomas/pi-opensync-plugin ~/.pi/agent/extensions/pi-opensync-plugin
```

## Configuration

Once installed, run `/opensync:config` in pi to interactively configure the extension.

Two options are required: `convexUrl` (your OpenSync deployment URL) and `apiKey` (your OpenSync API key).

### Manual Configuration

Create `~/.config/pi-opensync-plugin/config.json`:

```json
{
  "apiKey": "osk_your_api_key_here",
  "autoSync": true,
  "convexUrl": "https://your-opensync-deployment.convex.cloud",
  "debug": false,
  "syncThinking": false,
  "syncToolCalls": false
}
```

### Environment Variables

Environment variables take precedence over config file:

| Variable | Description |
|----------|-------------|
| `PI_OPENSYNC_API_KEY` | Your OpenSync API key (osk_...) |
| `PI_OPENSYNC_AUTO_SYNC` | Enable automatic syncing (default: true) |
| `PI_OPENSYNC_CONVEX_URL` | OpenSync Convex deployment URL |
| `PI_OPENSYNC_DEBUG` | Enable debug logging (default: false) |
| `PI_OPENSYNC_THINKING` | Include thinking content (default: false) |
| `PI_OPENSYNC_TOOL_CALLS` | Sync tool calls (default: false) |

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
bun install            # Install dependencies
bun run test           # Run tests
bun run test:watch     # Run tests in watch mode
bun run typecheck      # Type check
```

## License

pi-opensync-plugin is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
