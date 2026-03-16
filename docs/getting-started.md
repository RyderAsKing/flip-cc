# Getting Started with flip-cc

flip-cc is a CLI wrapper for Claude Code that lets you switch between AI providers — Anthropic (subscription or API key), Moonshot Kimi, OpenRouter, or any OpenAI-compatible endpoint — using a named profile system. Instead of manually managing environment variables, flip-cc isolates each provider's credentials and launches Claude Code with the correct configuration automatically.

## Prerequisites

### Claude Code

flip-cc launches `claude`, so Claude Code must be installed and on your `PATH`:

```bash
npm install -g @anthropic-ai/claude-code
```

Verify it works:

```bash
claude --version
```

### API keys / accounts by provider

| Provider | What you need |
|----------|---------------|
| Anthropic (subscription) | A claude.ai Pro or Max subscription; no API key needed |
| Anthropic (API key) | An API key from [console.anthropic.com](https://console.anthropic.com) (`sk-ant-...`) |
| Moonshot Kimi | An API key from [platform.moonshot.cn](https://platform.moonshot.cn) |
| OpenRouter | An API key from [openrouter.ai](https://openrouter.ai) (`sk-or-v1-...`) |
| OpenAI-compatible | API key and base URL for your endpoint |

---

## Installation

### Quick install (Linux and macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/install.sh | sh
```

The script detects your platform, downloads the correct pre-built binary from the latest GitHub release, and installs it to `/usr/local/bin/flip-cc`. `sudo` is used automatically if the directory is not user-writable.

Supported targets:

- Linux x64
- macOS x64
- macOS arm64 (Apple Silicon)

### Manual install

1. Download the binary for your platform from the [releases page](https://github.com/RyderAsKing/flip-cc/releases).
2. Make it executable and move it to a directory on your `PATH`:

```bash
chmod +x flip-cc-linux-x64
sudo mv flip-cc-linux-x64 /usr/local/bin/flip-cc
```

### Windows / WSL

Native Windows binaries (`flip-cc-windows-x64.exe`) are available but have limited testing. WSL (Windows Subsystem for Linux) with the Linux binary is the recommended approach on Windows.

### Verify

```bash
flip-cc --version
```

---

## First run: `flip-cc setup`

Run the setup wizard to create your initial profile:

```bash
flip-cc setup
```

The wizard walks you through selecting a provider and entering the required credentials. When it completes, a profile is saved to your local configuration store and set as the default.

---

## Creating your first profile

You can add profiles at any time with:

```bash
flip-cc profile add
```

Example walkthrough for a Kimi profile:

```
? Profile ID (alphanumeric, dashes, underscores): kimi
? Display name: Moonshot Kimi 2.5
? Provider: Kimi (Moonshot)
? API key: sk-...
? Description (optional): Kimi coding assistant
```

flip-cc pre-fills the base URL (`https://api.kimi.com/coding/`), model (`kimi-for-coding`), and extra environment variables (`ENABLE_TOOL_SEARCH=false`) for the Kimi provider. You can accept the defaults or override them.

For an Anthropic subscription profile, leave the API key blank:

```
? Profile ID: claude
? Display name: Claude (Subscription)
? Provider: Anthropic
? API key: (leave empty for subscription mode)
```

---

## Launching Claude Code

### Launch with the default profile

```bash
flip-cc launch
```

### Launch with a specific profile

```bash
flip-cc launch kimi
flip-cc launch claude
flip-cc launch my-openrouter-profile
```

### Anthropic API key mode

Anthropic profiles default to subscription mode even if an API key is stored. To use the API key instead:

```bash
flip-cc launch claude --key
```

---

## Verifying which backend is active

Inside a running Claude Code session, type:

```
/status
```

Claude Code displays the current model, API endpoint, and authentication method. For non-Anthropic providers the base URL will reflect the provider's endpoint.

---

## Listing profiles

```bash
flip-cc profile list
```

Output shows each profile's ID, name, provider, and a masked API key (first 4 and last 4 characters visible).

---

## Viewing statistics

flip-cc tracks session duration for every profile launch. View your stats with:

```bash
# Show stats for all profiles
flip-cc stats

# Show stats for a specific profile
flip-cc stats kimi

# Clear all statistics
flip-cc stats --clear

# Clear statistics for a specific profile
flip-cc stats --clear kimi
```

The output shows per-profile session counts and time spent in the last 30 days, total time across all sessions, average session length, and the date of the most recent session. Up to 200 sessions are retained.

---

## Upgrading

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/upgrade.sh | sh
```

The upgrade script backs up your configuration, removes the old binary, installs the latest version, then restores your configuration. Your profiles and API keys are preserved.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/uninstall.sh | sh
```

The uninstaller removes the `flip-cc` binary and your configuration directory. Claude Code itself is not affected — your Claude Code settings, MCP servers, and credentials remain intact.

To remove manually:

```bash
sudo rm /usr/local/bin/flip-cc
rm -rf ~/.config/flip-cc-nodejs   # Linux
# or
rm -rf ~/Library/Preferences/flip-cc-nodejs  # macOS
```
