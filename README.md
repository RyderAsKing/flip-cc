# 🔀 flip-cc

**flip-cc** is a lightweight, secure CLI launcher for Claude Code. It enables seamless switching between multiple AI providers—Anthropic Claude, Moonshot Kimi, OpenRouter, and custom OpenAI-compatible endpoints—through a flexible **profile-based** system.

By securely storing your API keys and configuration locally, `flip-cc` injects the necessary environment variables on a per-session basis before launching Claude Code. No more manual juggling of environment variables or authentication conflicts.

## ✨ Key Features

- **Multi-Provider Support:** Switch between Anthropic, Moonshot Kimi, OpenRouter, and custom OpenAI-compatible endpoints.
- **Profile-Based Configuration:** Create unlimited profiles with different providers, models, and settings.
- **Flexible Auth:** Use claude.ai subscriptions or API keys—configure per-profile.
- **Bring Your Own Key (BYOK):** Retain full control. Supply your own API keys for any supported provider.
- **Secure Local Vault:** Keys are stored securely on your local machine using OS-level configurations. No remote servers, no data collection.
- **Smart Environment Injection:** Automatically handles API base URLs, models, and provider-specific environment variables.
- **Auth Conflict Prevention:** Uses isolated home directories to prevent conflicts between claude.ai sessions and API key authentication.
- **MCP Server Support:** Preserves MCP server connections (like Figma) across all launch modes.
- **Zero Network Overhead:** Because `flip-cc` is just a launcher and not a proxy server, your API requests go straight to the provider with zero added latency.
- **Standalone Executable:** Distributed as a compiled binary. No Node.js environment required to run it.
- **Automatic Migration:** Seamlessly migrates existing v0.2.x configurations to the new profile system.

## ⚙️ How it Works

Claude Code supports two authentication modes for Anthropic: a **claude.ai subscription** (Pro/Max) or a direct **API key**. Other providers like Kimi and OpenRouter always require an API key.

**Profile System:** Instead of hardcoded modes, `flip-cc` uses profiles—named configurations that specify:
- Which provider to use (Anthropic, Kimi, OpenRouter, OpenAI-compatible)
- Authentication credentials (API key or subscription mode)
- Model selection (e.g., Claude 3.5 Sonnet, GPT-4, Kimi 2.5)
- Custom base URLs (for OpenAI-compatible endpoints)
- Extra environment variables

**Subscription mode** (`anthropic` provider without API key): No API key needed. `flip-cc` launches `claude` cleanly, letting Claude Code authenticate via your claude.ai login session. Any existing `ANTHROPIC_API_KEY` environment variable is explicitly unset to prevent conflicts.

**API key mode** (`anthropic` provider with API key, or any other provider): `flip-cc` creates an isolated environment (temp home directory) that excludes your claude.ai session tokens, then injects your saved API key before spawning the process. This prevents the "Auth conflict" error.

**Provider-specific configuration:** Each profile automatically sets the appropriate environment variables:

| Provider | Environment Variables Set |
|----------|---------------------------|
| **Anthropic (API key)** | `ANTHROPIC_API_KEY=<your-key>` |
| **Anthropic (Subscription)** | `ANTHROPIC_API_KEY=undefined` (to prevent conflicts) |
| **Kimi** | `ANTHROPIC_API_KEY=<kimi-key>`, `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`, `ENABLE_TOOL_SEARCH=false` |
| **OpenRouter** | `ANTHROPIC_API_KEY=<openrouter-key>`, `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`, model routing headers |
| **OpenAI-compatible** | `ANTHROPIC_API_KEY=<api-key>`, `ANTHROPIC_BASE_URL=<custom-url>`, optional model |

When you close the session, your global system environment remains completely untouched.

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
- **For OpenRouter:** An [OpenRouter API key](https://openrouter.ai/).
- **For OpenAI-compatible:** API key and endpoint URL for your provider.

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
1. Back up your existing configuration
2. Remove the old binary
3. Download and install the latest version
4. Restore your configuration

Your profiles, API keys, and VSCode configuration will be preserved.

### Migration from v0.2.x

If you're upgrading from flip-cc v0.2.x, your existing configuration will be automatically migrated:

- **Old `claude` (subscription)** → New `claude` profile
- **Old `claude --key`** → New `claude-api` profile (if you had an Anthropic API key)
- **Old `kimi`** → New `kimi` profile

Run `flip-cc profile list` after upgrading to see your migrated profiles.

## 📋 Quick Usage

### 1. Initial Setup

Run the setup command to create your first profile:

```bash
flip-cc setup
```

This interactive wizard will guide you through creating your first profile. Alternatively, you can use the profile commands directly.

### 2. Profile Management

```bash
# List all profiles
flip-cc profile list

# Add a new profile
flip-cc profile add

# Edit an existing profile
flip-cc profile edit <profile-id>

# Remove a profile
flip-cc profile remove <profile-id>

# Set the default profile
flip-cc profile set-default <profile-id>
```

### 3. Launch Claude Code

```bash
# Launch with the default profile
flip-cc launch

# Launch with a specific profile
flip-cc launch kimi
flip-cc launch claude
flip-cc launch my-openrouter-profile

# For Anthropic profiles: force API key mode (subscription is default)
flip-cc launch claude-api --key
```

### 4. VSCode Extension Integration

Configure the Claude Code VSCode extension to use a specific profile:

```bash
flip-cc vscode-config
```

This interactive wizard lets you select which profile to use in VSCode. To remove the configuration:

```bash
flip-cc vscode-config --remove
```

## 🔌 Profile System

Profiles are the core of flip-cc's flexibility. Each profile defines:

- **Provider:** Which AI service to use (Anthropic, Kimi, OpenRouter, OpenAI-compatible)
- **Authentication:** API key or subscription mode (Anthropic only)
- **Model:** Optional model override (e.g., `anthropic/claude-3.5-sonnet` for OpenRouter)
- **Base URL:** Custom endpoint for OpenAI-compatible providers
- **Extra Environment Variables:** Additional env vars to set when launching

### Built-in Profiles

After setup, you'll have these default profiles:

| Profile ID | Provider | Description |
|------------|----------|-------------|
| `claude` | Anthropic | Subscription mode (uses your claude.ai login) |

### Creating Custom Profiles

Add profiles for other providers:

```bash
flip-cc profile add
```

**Example: OpenRouter Profile**
```
Provider: OpenRouter
Profile ID: openrouter-sonnet
Display name: OpenRouter Claude Sonnet
API Key: sk-or-v1-...
Model: Claude 3.5 Sonnet
```

**Example: Custom OpenAI-compatible Endpoint**
```
Provider: OpenAI-compatible
Profile ID: local-llm
Display name: Local LLM Server
API Key: your-key
Base URL: http://localhost:8000/v1
Model: (optional)
```

## 🔌 VSCode Extension Integration

`flip-cc vscode-config` configures the official Claude Code VSCode extension to use your chosen profile by writing the appropriate environment variables directly into your VSCode `settings.json`.

### How It Works

1. Run the wizard — it asks which profile you want to use in VSCode.
2. flip-cc writes `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt` into your `settings.json`.
3. Fully restart VSCode — the extension picks up the new settings automatically.

No PATH manipulation, no binary shims. Your existing VSCode settings are preserved.

### Setup

```bash
flip-cc vscode-config
```

The wizard will show all your configured profiles to choose from.

### Switching Profiles

Run the wizard again and select a different profile:

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

**API key mode (Anthropic, OpenRouter, etc.):**
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
│   ├── types.ts              # TypeScript types (Profile, ProviderType, AppConfig)
│   ├── commands/
│   │   ├── setup.ts          # Setup wizard
│   │   ├── launch.ts         # Launch logic with env isolation
│   │   ├── vscode-config.ts  # VSCode extension integration
│   │   └── profile.ts        # Profile management (list, add, edit, remove, set-default)
│   └── lib/
│       ├── config.ts         # Config storage wrapper
│       ├── profiles.ts       # Profile CRUD operations
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

For detailed technical documentation including architecture decisions, authentication flow, configuration migration, and implementation details, see [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md).

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

MIT License - Copyright (c) 2026 Rajat Asthana
