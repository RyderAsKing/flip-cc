# 🔀 flip-cc

**flip-cc** is a lightweight CLI launcher for Claude Code that enables seamless switching between AI providers—Anthropic, Moonshot Kimi, OpenRouter, and custom OpenAI-compatible endpoints—through a profile-based system. API keys are stored locally and injected per-session; your global environment is never modified.

## ✨ Key Features

- **Multi-Provider:** Anthropic (subscription or API key), Moonshot Kimi, OpenRouter, any OpenAI-compatible endpoint
- **Profile-Based:** Unlimited named profiles, each with its own provider, model, and credentials
- **Auth Conflict Prevention:** Isolated home directories prevent claude.ai session tokens from conflicting with API keys
- **MCP Server Support:** Preserves MCP connections (Figma, etc.) across all launch modes
- **Session Stats:** Track time spent per profile with `flip-cc stats`
- **Zero Latency:** Direct launcher — no proxy, no added overhead
- **Standalone Binary:** No Node.js required

## 🚀 Installation

```bash
curl -fsSL https://raw.githubusercontent.com/RyderAsKing/flip-cc/main/install.sh | bash
```

**Manual:** Download the binary for your platform from the [Releases page](https://github.com/RyderAsKing/flip-cc/releases), move it to your PATH, and `chmod +x flip-cc`.

**Windows:** Use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) and run the Linux install command above.

> For full installation, upgrade, and uninstall instructions see [docs/getting-started.md](./docs/getting-started.md).

## ⚡ Quick Start

```bash
# 1. Run the setup wizard
flip-cc setup

# 2. Launch with default profile
flip-cc launch

# 3. Launch a specific profile
flip-cc launch kimi
flip-cc launch my-openrouter-profile

# 4. Manage profiles
flip-cc profile list
flip-cc profile add
flip-cc profile edit <id>
flip-cc profile remove <id>
flip-cc profile set-default <id>

# 5. View session statistics
flip-cc stats
flip-cc stats kimi

# 6. Configure VSCode extension
flip-cc vscode-config
```

## 📚 Documentation

| Doc                                                      | Description                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Getting Started](./docs/getting-started.md)             | Install, first setup, launch, verify, upgrade/uninstall                        |
| [Profiles](./docs/profiles.md)                           | Profile fields, commands, providers, config paths, v0.2.x migration            |
| [VSCode Integration](./docs/vscode-integration.md)       | Configure the Claude Code VSCode extension                                     |
| [Architecture](./docs/architecture.md)                   | Internals, data flow, environment isolation, proxy, security, adding providers |
| [Technical Reference](./docs/technical_documentation.md) | Comprehensive developer reference                                              |

## 🔧 Development

```bash
bun install
bun run dev setup       # run in dev mode
bun run typecheck       # type check
bun run build           # build all platform binaries
```

See [Architecture docs](./docs/architecture.md) for a full developer guide.

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

## 📄 License

MIT License - Copyright (c) 2026 Rajat Asthana
