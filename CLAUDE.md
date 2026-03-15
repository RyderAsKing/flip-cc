# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build System

This project uses **Bun** as the runtime and compiler (not Node.js).

```bash
# Development (runs TypeScript directly)
bun run dev setup
bun run dev launch kimi

# Type checking
bun run typecheck

# Build standalone binaries for all platforms
bun run build
```

The build script (`build.ts`) compiles to four targets using Bun's `--compile` flag:
- `flip-cc-linux-x64`
- `flip-cc-macos-x64`
- `flip-cc-macos-arm64`
- `flip-cc-windows-x64.exe`

Output goes to `dist/`. A platform-specific binary (`flip-cc` or `flip-cc.exe`) is also created for the current platform.

## Architecture

**flip-cc** is a CLI wrapper for Claude Code that enables switching between Anthropic (subscription/API key) and Moonshot Kimi 2.5 backends.

### Core Problem Solved

Claude Code stores claude.ai session tokens in `~/.claude/.credentials.json`. When `ANTHROPIC_API_KEY` is also set, this creates an "Auth conflict" error. flip-cc solves this through **environment isolation**.

### Key Architectural Pattern: Isolated Home Directories

The `createIsolatedHomeForApiKey()` function in `src/commands/launch.ts` creates a temporary `$HOME` directory for API key modes:

1. Copies `~/.claude.json` (user settings, themes)
2. Copies all of `~/.claude/` **except** `.credentials.json`
3. Selectively copies only `mcpOAuth` and `organizationUuid` from credentials (preserves MCP servers like Figma)
4. Excludes `claudeAiOauth` (the claude.ai session token)
5. Creates `~/.local/bin/claude` symlink to the real binary
6. Sets `HOME` and `PATH` env vars to the temp directory

This allows API key modes to work without conflicts while keeping MCP servers connected.

### Launch Modes

| Mode | Target | Auth | Home Dir | Key Env Vars |
|------|--------|------|----------|--------------|
| `launch claude` | Anthropic | Subscription | Real `$HOME` | `ANTHROPIC_API_KEY=undefined` |
| `launch claude --key` | Anthropic | API Key | Isolated temp | `ANTHROPIC_API_KEY=<key>`, `HOME=<temp>` |
| `launch kimi` | Moonshot | API Key | Isolated temp | `ANTHROPIC_API_KEY=<kimi-key>`, `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`, `HOME=<temp>` |

The temp home directory is cleaned up in a `finally` block after the Claude process exits.

### VSCode Extension Integration

The `vscode-config` command modifies VSCode's `settings.json` directly (not via PATH shims):

- Writes `claudeCode.environmentVariables` array with the same env vars as launch modes
- Also sets `claudeCode.disableLoginPrompt: true` for API key modes
- Backs up original to `settings.json.flip-cc.bak`
- Uses line-based parsing to cleanly insert/remove only flip-cc managed keys

Platform-specific settings.json paths:
- macOS: `~/Library/Application Support/Code/User/settings.json`
- Linux: `~/.config/Code/User/settings.json`
- Windows: `%APPDATA%/Code/User/settings.json`

### Configuration Storage

Uses the `conf` library for OS-specific secure storage:
- macOS: `~/Library/Preferences/flip-cc/`
- Linux: `~/.config/flip-cc/`
- Windows: `%APPDATA%\flip-cc\`

Schema defined in `src/lib/config.ts` with fields: `claudeAuthMode`, `anthropicApiKey`, `kimiApiKey`, `setupComplete`.

### Process Spawning

`src/lib/spawn.ts` wraps `child_process.spawn` with:
- `stdio: 'inherit'` for full terminal passthrough (colors, interactive input)
- Environment variable overrides (including `undefined` to delete vars)
- Signal forwarding (`SIGINT`, `SIGTERM`) for proper Ctrl-C handling
- Windows compatibility via `shell: true`

## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander.js setup)
├── types.ts              # TypeScript types (AuthMode, LaunchTarget, AppConfig)
├── commands/
│   ├── setup.ts          # Interactive setup wizard (inquirer prompts)
│   ├── launch.ts         # Environment isolation and spawning logic
│   └── vscode-config.ts  # VSCode settings.json manipulation
└── lib/
    ├── config.ts         # Conf-based configuration wrapper
    ├── spawn.ts          # child_process wrapper with stdio inheritance
    └── validate.ts       # API key format validation
```

## Dependencies

- `commander` - CLI framework
- `@inquirer/prompts` - Interactive prompts
- `chalk` - Terminal colors
- `conf` - Secure local config storage

All dependencies are bundled into the standalone binary by Bun's compiler.
