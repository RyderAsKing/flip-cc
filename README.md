# 🔀 flip-cc

**flip-cc** is a lightweight, secure CLI launcher for Claude Code. It allows developers to seamlessly switch between Anthropic's Claude models and Moonshot's Kimi 2.5 without manually juggling environment variables or API keys.

By leveraging Kimi's Anthropic-compatible API endpoints, `flip-cc` acts as a smart wrapper. It securely stores your keys locally and injects the necessary environment overrides on a per-session basis before launching Claude Code.

## ✨ Key Features

- **Flexible Auth:** Use a claude.ai subscription (Pro/Max) or bring your own Anthropic API key — your choice.
- **Bring Your Own Key (BYOK):** Retain full control. Supply your own Anthropic and/or Kimi API keys.
- **Secure Local Vault:** Keys are stored securely on your local machine using OS-level configurations. No remote servers, no data collection.
- **Smart Environment Injection:** Automatically handles the Kimi 2.5 API overrides (`ANTHROPIC_BASE_URL` and `ENABLE_TOOL_SEARCH`) dynamically in the background.
- **Zero Network Overhead:** Because `flip-cc` is just a launcher and not a proxy server, your API requests go straight to Anthropic or Moonshot with zero added latency.
- **Standalone Executable:** Distributed as a compiled binary. No Node.js environment required to run it.

## ⚙️ How it Works

Claude Code supports two authentication modes for the Anthropic side: a **claude.ai subscription** (Pro/Max) or a direct **API key**. Kimi 2.5 always requires a key and offers a fully compatible API structure.

**Subscription mode** (`claude`): No API key needed. `flip-cc` launches `claude` cleanly, letting Claude Code authenticate via your claude.ai login session.

**API key mode** (`claude --key`): `flip-cc` injects your saved Anthropic key before spawning the process.

**Kimi mode**: `flip-cc` quietly does this in the background:

```bash
export ENABLE_TOOL_SEARCH=false
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_API_KEY=<your-saved-kimi-key>
```

...and then immediately spawns the `claude` process. When you close the session, your global system environment remains completely untouched.

## 🚀 Getting Started

### Prerequisites

- You must have Anthropic's `claude-code` installed globally.
- **For Anthropic:** Either a [claude.ai](https://claude.ai) Pro or Max subscription, **or** an [Anthropic API key](https://console.anthropic.com/).
- **For Kimi:** A [Moonshot AI API key](https://platform.moonshot.cn/).

### Installation

Download the latest pre-compiled binary for your operating system from the Releases page, or install via our quick script:

**macOS / Linux:**

```bash
curl -fsSL [https://flip-cc.com/install.sh](https://flip-cc.com/install.sh) | bash

```

**Windows:**
Download `flip-cc.exe` and add it to your system PATH.

### Quick Usage

1. **One-Time Setup:**
   Run the setup command. You'll be asked whether you use a claude.ai subscription or an API key for the Anthropic side, and prompted for any keys you want to store.

```bash
flip-cc setup
```

2. **Launch Claude Code:**
   Launch your coding assistant with your backend of choice.

```bash
flip-cc launch kimi              # Launches with Kimi 2.5 environment variables
flip-cc launch claude            # Launches via claude.ai subscription (no key needed)
flip-cc launch claude --key      # Launches with your saved Anthropic API key
```

## 🛠️ Tech Stack

- **Core:** Node.js & TypeScript
- **CLI Framework:** Commander.js
- **Local Storage:** Conf (Secure local configuration)
- **Process Management:** Node `child_process.spawn`
- **Compiler:** Bun (compiled to standalone binaries)

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

MIT License - Copyright (c) 2026 Rajat Asthana
