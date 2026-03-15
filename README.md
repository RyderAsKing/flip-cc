# 🔀 flip-cc

**flip-cc** is a lightweight, secure CLI launcher for Claude Code. It allows developers to seamlessly switch between Anthropic's Claude models and Moonshot's Kimi 2.5 without manually juggling environment variables or API keys.

By leveraging Kimi's Anthropic-compatible API endpoints, `flip-cc` acts as a smart wrapper. It securely stores your keys locally and injects the necessary environment overrides on a per-session basis before launching Claude Code.

## ✨ Key Features

- **Flexible Auth:** Use a claude.ai subscription (Pro/Max) or bring your own Anthropic API key — your choice.
- **Bring Your Own Key (BYOK):** Retain full control. Supply your own Anthropic and/or Kimi API keys.
- **Secure Local Vault:** Keys are stored securely on your local machine using OS-level configurations. No remote servers, no data collection.
- **Smart Environment Injection:** Automatically handles the Kimi 2.5 API overrides (`ANTHROPIC_BASE_URL` and `ENABLE_TOOL_SEARCH`) dynamically in the background.
- **Auth Conflict Prevention:** Uses isolated home directories to prevent conflicts between claude.ai sessions and API key authentication.
- **MCP Server Support:** Preserves MCP server connections (like Figma) across all launch modes.
- **Zero Network Overhead:** Because `flip-cc` is just a launcher and not a proxy server, your API requests go straight to Anthropic or Moonshot with zero added latency.
- **Standalone Executable:** Distributed as a compiled binary. No Node.js environment required to run it.

## ⚙️ How it Works

Claude Code supports two authentication modes for the Anthropic side: a **claude.ai subscription** (Pro/Max) or a direct **API key**. Kimi 2.5 always requires a key and offers a fully compatible API structure.

**Subscription mode** (`claude`): No API key needed. `flip-cc` launches `claude` cleanly, letting Claude Code authenticate via your claude.ai login session. Any existing `ANTHROPIC_API_KEY` environment variable is explicitly unset to prevent conflicts.

**API key mode** (`claude --key`): `flip-cc` creates an isolated environment (temp home directory) that excludes your claude.ai session tokens, then injects your saved Anthropic key before spawning the process. This prevents the "Auth conflict" error.

**Kimi mode** (`kimi`): `flip-cc` creates an isolated environment and quietly sets these environment variables:

```bash
export ENABLE_TOOL_SEARCH=false
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_API_KEY=<your-saved-kimi-key>
```

...and then immediately spawns the `claude` process. When you close the session, your global system environment remains completely untouched.

### Authentication Isolation

The main challenge with switching between providers is that Claude Code stores claude.ai session tokens in `~/.claude/.credentials.json`. When combined with `ANTHROPIC_API_KEY`, this creates an auth conflict.

`flip-cc` solves this by:
1. Creating a temporary isolated `$HOME` directory for API key modes
2. Copying your settings and preferences (themes, history, MCP config)
3. Selectively copying only MCP OAuth tokens (preserving Figma, etc.)
4. Excluding the claude.ai session token

This allows you to use API key modes without conflicts while keeping your MCP servers connected.

## 🚀 Getting Started

### Prerequisites

- You must have Anthropic's `claude-code` installed globally.
- **For Anthropic:** Either a [claude.ai](https://claude.ai) Pro or Max subscription, **or** an [Anthropic API key](https://console.anthropic.com/).
- **For Kimi:** A [Moonshot AI API key](https://platform.moonshot.cn/).

### Installation

Download the latest pre-compiled binary for your operating system from the [Releases page](https://github.com/RyderAsKing/flip-cc/releases), or install via our quick script:

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/install.sh | bash
```

Or with sudo if required:
```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/install.sh | sudo bash
```

**Windows:**
Windows users can run flip-cc via [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) (Windows Subsystem for Linux). Install WSL, then run the Linux installation command above in your WSL terminal.

**Manual Installation:**
1. Download the appropriate binary for your platform from the [latest release](https://github.com/RyderAsKing/flip-cc/releases/latest)
2. Rename it to `flip-cc`
3. Move it to a directory in your PATH (e.g., `/usr/local/bin`, `$HOME/.local/bin`)
4. Make it executable: `chmod +x flip-cc`

### Uninstallation

To remove flip-cc (Claude Code will remain unaffected):

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/uninstall.sh | bash
```

This removes:
- The `flip-cc` binary
- flip-cc's configuration directory (API keys stored by flip-cc)

Your Claude Code installation, settings, and MCP servers remain completely untouched.

### Upgrade

To upgrade to the latest version while preserving your configuration and API keys:

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/upgrade.sh | bash
```

The upgrade script will:
1. Back up your existing API keys and configuration
2. Remove the old binary
3. Download and install the latest version
4. Restore your configuration

Your API keys, Kimi settings, and VSCode configuration will be preserved.

### Quick Usage

1. **One-Time Setup:**
   Run the setup command. You'll be asked whether you use a claude.ai subscription or an API key for the Anthropic side, and prompted for any keys you want to store.

```bash
flip-cc setup
```

2. **Launch Claude Code (Terminal):**
   Launch your coding assistant with your backend of choice.

```bash
flip-cc launch kimi              # Launches with Kimi 2.5 environment variables
flip-cc launch claude            # Launches via claude.ai subscription (no key needed)
flip-cc launch claude --key      # Launches with your saved Anthropic API key
```

3. **Use with VSCode Extension (Optional):**
   Run the interactive setup to configure the Claude Code VSCode extension to use a specific backend.

```bash
flip-cc vscode-config            # Interactive setup wizard
```

This will guide you through selecting your preferred backend and write the necessary environment variables directly to your VSCode `settings.json`.

### 🔌 VSCode Extension Integration

`flip-cc vscode-config` configures the official Claude Code VSCode extension to use your chosen backend by writing the appropriate environment variables directly into your VSCode `settings.json`.

### How It Works

1. Run the wizard — it asks which backend you want to use in VSCode.
2. flip-cc writes `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt` into your `settings.json`.
3. Fully restart VSCode — the extension picks up the new settings automatically.

No PATH manipulation, no binary shims. Your existing VSCode settings are preserved.

### Setup

```bash
flip-cc vscode-config
```

The wizard will ask which backend to use:

| Mode | Description |
|------|-------------|
| `kimi` | Moonshot Kimi 2.5 via your saved Kimi API key |
| `claude-key` | Claude via your saved Anthropic API key |
| `claude-subscription` | Claude via your claude.ai Pro/Max subscription |

### Switching Modes

Run the wizard again and select a different backend:

```bash
flip-cc vscode-config
```

Then fully restart VSCode (`Ctrl+Shift+P → Quit`, then relaunch).

### Removing the Configuration

```bash
flip-cc vscode-config --remove
```

This removes the `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt` entries from your `settings.json`. A backup is saved as `settings.json.flip-cc.bak` before any change is made.

## Verification

To verify which backend you're using, run `/status` inside Claude Code:

**Kimi mode:**
```
Auth token: none
API key: ANTHROPIC_API_KEY
Anthropic base URL: https://api.kimi.com/coding/
```

**Subscription mode:**
```
Auth token: present
API key: none
```

**API key mode:**
```
Auth token: none
API key: ANTHROPIC_API_KEY
```

## 🛠️ Tech Stack

- **Core:** TypeScript
- **CLI Framework:** Commander.js
- **Interactive Prompts:** @inquirer/prompts
- **Local Storage:** Conf (Secure local configuration)
- **Process Management:** Node `child_process.spawn`
- **Compiler:** Bun (compiled to standalone binaries)

## 📁 Project Structure

```
flip-cc/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── types.ts              # TypeScript types
│   ├── commands/
│   │   ├── setup.ts          # Setup wizard
│   │   ├── launch.ts         # Launch logic with env isolation
│   │   └── vscode-config.ts  # VSCode extension integration
│   └── lib/
│       ├── config.ts         # Config storage wrapper
│       ├── spawn.ts          # Process spawning utilities
│       └── validate.ts       # Input validation
├── build.ts                  # Multi-platform build script
├── package.json              # Dependencies
└── tsconfig.json             # TypeScript config
```

## 🔧 Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev setup
bun run dev launch kimi

# Type check
bun run typecheck

# Build all platform binaries
bun run build

# Run compiled binary
./dist/flip-cc-linux-x64 --help
```

## 📚 Technical Documentation

For detailed technical documentation including architecture decisions, authentication flow, and implementation details, see [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md).

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

MIT License - Copyright (c) 2026 Rajat Asthana
