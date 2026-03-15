# Technical Documentation

This document provides a comprehensive overview of the `flip-cc` implementation, including architecture decisions, problem solutions, and how each component works.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Key Components](#key-components)
   - [Configuration Management](#configuration-management)
   - [Environment Isolation](#environment-isolation)
   - [Process Spawning](#process-spawning)
   - [VSCode Extension Integration](#vscode-extension-integration)
   - [Input Validation](#input-validation)
4. [Authentication & Auth Conflict Resolution](#authentication--auth-conflict-resolution)
5. [Launch Modes](#launch-modes)
6. [Build System](#build-system)
7. [Security Considerations](#security-considerations)

---

## Architecture Overview

`flip-cc` is a TypeScript CLI application that wraps Claude Code. It provides a seamless way to switch between:
- **Anthropic Claude** (subscription or API key)
- **Moonshot Kimi 2.5** (via API key with environment injection)

The application is designed to be:
- **Stateless**: No persistent server or background process
- **Secure**: Keys stored in OS-level secure config directories
- **Non-intrusive**: Uses isolated environments to avoid conflicts
- **Standalone**: Compiled to single binaries with no runtime dependencies

---

## Project Structure

```
flip-cc/
├── src/
│   ├── index.ts              # CLI entry point (Commander.js setup)
│   ├── types.ts              # Shared TypeScript types
│   ├── commands/
│   │   ├── setup.ts          # Interactive setup wizard
│   │   ├── launch.ts         # Launch logic with environment isolation
│   │   └── vscode-config.ts  # VSCode extension integration
│   └── lib/
│       ├── config.ts         # Conf-based configuration wrapper
│       ├── spawn.ts          # child_process wrapper with stdio inheritance
│       └── validate.ts       # Input validation helpers
├── build.ts                  # Bun multi-platform compiler script
├── package.json              # ESM dependencies
├── tsconfig.json             # TypeScript configuration
└── dist/                     # Compiled binaries
    ├── flip-cc-linux-x64
    ├── flip-cc-macos-x64
    ├── flip-cc-macos-arm64
    └── flip-cc-windows-x64.exe
```

---

## Key Components

### Configuration Management (`src/lib/config.ts`)

Uses the `conf` library for secure, OS-specific configuration storage:

**Storage Locations:**
- macOS: `~/Library/Preferences/flip-cc/`
- Linux: `~/.config/flip-cc/`
- Windows: `%APPDATA%\flip-cc\`

**Schema:**
```typescript
interface AppConfig {
  claudeAuthMode: 'subscription' | 'api-key';
  anthropicApiKey?: string;
  kimiApiKey?: string;
  setupComplete: boolean;
}
```

**Key Functions:**
- `getConfig()` - Retrieve full configuration
- `setConfig(patch)` - Merge partial updates
- `isSetupComplete()` - Check if initial setup done
- `getConfigPath()` - Get storage location (for debugging)

**Security Note:** Config files use OS file permissions (like AWS CLI, npm). No keytar/native modules to maintain Bun compile compatibility.

---

### Environment Isolation (`src/commands/launch.ts`)

The core challenge: Claude Code stores session data in `~/.claude/.credentials.json`. When switching between subscription and API key modes, this creates authentication conflicts.

**The Problem:**
```
Auth conflict: Both a token (claude.ai) and an API key (ANTHROPIC_API_KEY) are set.
```

**The Solution:** Create isolated `$HOME` directories for API key modes

**Function: `createIsolatedHomeForApiKey()`**

Creates a temporary home directory that:
1. Creates `~/.local/bin` and symlinks the real `claude` binary (fixes "installMethod is native, but claude command not found" error)
2. Copies `~/.claude.json` (user settings, theme preferences)
3. Copies all of `~/.claude/` **except** `.credentials.json`
4. Selectively copies only `mcpOAuth` and `organizationUuid` from credentials (preserves MCP server auth)
5. Updates `PATH` env var to include the isolated bin directory

**Preserved Data:**
- `~/.claude.json` - Main config (themes, settings)
- `~/.claude/settings.json` - Plugin/MCP server config
- `~/.claude/history.jsonl` - Conversation history
- `~/.claude/sessions/` - Session data
- `~/.claude/.credentials.json` - **Only** `mcpOAuth` and `organizationUuid` fields

**Excluded Data:**
- `~/.claude/.credentials.json` - `claudeAiOauth` field (the claude.ai session token)

This allows MCP servers (like Figma) to remain connected while preventing the auth conflict with claude.ai sessions.

---

### Process Spawning (`src/lib/spawn.ts`)

Wraps Node.js `child_process.spawn` with:

**Features:**
- `stdio: 'inherit'` - Full terminal passthrough (colors, interactive input)
- Environment variable overrides (including `undefined` to delete vars)
- Signal forwarding (`SIGINT`, `SIGTERM`) for proper Ctrl-C handling
- Windows compatibility (`shell: true` for `.cmd`/`.exe` resolution)
- Exit code propagation

**Interface:**
```typescript
interface SpawnOptions {
  envOverrides?: Record<string, string | undefined>;
  cwd?: string;
}

await spawnWithInheritance('claude', [], {
  envOverrides: {
    ANTHROPIC_API_KEY: 'sk-ant-...',     // Set value
    ANTHROPIC_BASE_URL: 'https://...',   // Set value
    ENABLE_TOOL_SEARCH: 'false',         // Set value
    HOME: '/tmp/flip-cc-xxx',            // Override home
    ANTHROPIC_API_KEY: undefined,        // Delete if exists
  }
});
```

---

### VSCode Extension Integration (`src/commands/vscode-config.ts`)

Configures the official Claude Code VSCode extension by writing environment variables directly to VSCode's `settings.json`. Unlike the terminal launcher which uses isolated home directories, VSCode configuration relies on the extension's ability to read environment variables from settings.

**Platform-Specific Settings Paths:**
- macOS: `~/Library/Application Support/Code/User/settings.json`
- Linux: `~/.config/Code/User/settings.json`
- Windows: `%APPDATA%/Code/User/settings.json`

**How It Works:**

1. **Line-Based JSON Manipulation** - Uses careful line-based parsing to insert/remove only flip-cc managed keys without rewriting the entire file
2. **Backup Creation** - Always backs up original to `settings.json.flip-cc.bak` before modification
3. **Legacy Shim Removal** - Cleans up any old PATH-based shims from previous flip-cc versions

**Configuration Modes:**

| Mode | VSCode Setting | Value |
|------|----------------|-------|
| `kimi` | `claudeCode.environmentVariables` | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ENABLE_TOOL_SEARCH` |
| `claude-key` | `claudeCode.environmentVariables` | `ANTHROPIC_API_KEY` |
| `claude-subscription` | `claudeCode.environmentVariables` | `CLAUDE_CODE_MAX_THINKING_TOKENS=0` (prevents thinking block errors) |

All API key modes also set `claudeCode.disableLoginPrompt: true`.

**Removal:** The `--remove` flag strips `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt` from settings.json using line-based removal that preserves all other user settings.

---

### Input Validation (`src/lib/validate.ts`)

Pure validation functions with no dependencies:

**API Key Validation:**
- Anthropic: Must start with `sk-ant-`
- Kimi: Minimum 10 characters

**Setup Validation:**
- Checks if `setupComplete` flag is set
- Validates required keys exist for target mode

---

## Authentication & Auth Conflict Resolution

### Subscription Mode (`flip-cc launch claude`)

**Goal:** Use existing claude.ai login session

**Implementation:**
1. Explicitly **unsets** `ANTHROPIC_API_KEY` environment variable
2. Uses user's real `$HOME` directory
3. Claude Code finds the `claudeAiOauth` token in `~/.claude/.credentials.json`

**Env Overrides:**
```bash
ANTHROPIC_API_KEY=undefined  # Deleted from env
```

**VSCode Alternative:** Use `flip-cc vscode-config` and select "Claude (Subscription)" to configure the VSCode extension to use subscription auth. This sets `CLAUDE_CODE_MAX_THINKING_TOKENS=0` to prevent "Invalid signature in thinking block" errors that can occur when mixing subscription auth with certain Claude Code features.

### API Key Mode (`flip-cc launch claude --key`)

**Goal:** Use saved Anthropic API key, bypass subscription

**Implementation:**
1. Creates isolated home directory (excludes `claudeAiOauth`)
2. Injects saved `ANTHROPIC_API_KEY`
3. Updates `HOME` and `PATH` to use isolated directory

**Env Overrides:**
```bash
ANTHROPIC_API_KEY=<saved-key>
HOME=/tmp/flip-cc-apikey-xxx
PATH=/tmp/flip-cc-apikey-xxx/.local/bin:$PATH
USERPROFILE=/tmp/flip-cc-apikey-xxx  # Windows only
```

**VSCode Alternative:** Use `flip-cc vscode-config` and select "Claude (API Key)" to configure the VSCode extension to use your saved Anthropic API key.

### Kimi Mode (`flip-cc launch kimi`)

**Goal:** Route Claude Code to Kimi's API endpoint

**Implementation:**
1. Creates isolated home directory (excludes `claudeAiOauth`)
2. Injects Kimi API key as `ANTHROPIC_API_KEY`
3. Sets `ANTHROPIC_BASE_URL` to Kimi's endpoint
4. Disables tool search with `ENABLE_TOOL_SEARCH=false`

**Env Overrides:**
```bash
ANTHROPIC_API_KEY=<kimi-key>
ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
ANTHROPIC_MODEL=kimi-for-coding
ENABLE_TOOL_SEARCH=false
HOME=/tmp/flip-cc-apikey-xxx
PATH=/tmp/flip-cc-apikey-xxx/.local/bin:$PATH
USERPROFILE=/tmp/flip-cc-apikey-xxx  # Windows only
```

**Note on Model Names:** Kimi's API returns `claude-sonnet-4-6` as the model name for compatibility. This is expected - the actual LLM is Kimi 2.5.

**VSCode Alternative:** Use `flip-cc vscode-config` and select "Moonshot Kimi 2.5" to configure the VSCode extension to use your saved Kimi API key.

---

## Launch Modes Summary

| Mode | Target | Auth Method | Home Directory | Env Overrides |
|------|--------|-------------|----------------|---------------|
| `launch claude` | Anthropic | Subscription | Real `$HOME` | `ANTHROPIC_API_KEY=undefined` |
| `launch claude --key` | Anthropic | API Key | Isolated temp | `ANTHROPIC_API_KEY=<key>`, `HOME=<temp>`, `PATH=<temp>/.local/bin:$PATH`, `USERPROFILE=<temp>` (Windows) |
| `launch kimi` | Moonshot | API Key | Isolated temp | `ANTHROPIC_API_KEY=<kimi-key>`, `ANTHROPIC_BASE_URL=<kimi>`, `ANTHROPIC_MODEL=kimi-for-coding`, `ENABLE_TOOL_SEARCH=false`, `HOME=<temp>`, `PATH=<temp>/.local/bin:$PATH`, `USERPROFILE=<temp>` (Windows) |

---

## Build System

**Compiler:** Bun (not Node.js)

**Why Bun?**
- Native TypeScript support (no transpilation step)
- Single-binary compilation (`--compile` flag)
- Cross-platform targeting

**Build Script (`build.ts`):**

Compiles for 4 targets:
| Target | Output |
|--------|--------|
| `bun-linux-x64` | `flip-cc-linux-x64` |
| `bun-darwin-x64` | `flip-cc-macos-x64` |
| `bun-darwin-arm64` | `flip-cc-macos-arm64` |
| `bun-windows-x64` | `flip-cc-windows-x64.exe` |

**Build Command:**
```bash
bun build src/index.ts --compile --target=<target> --outfile=<outfile>
```

The `--compile` flag bundles:
- Bun runtime
- All npm dependencies
- Your TypeScript source

Into a single standalone executable with no external dependencies.

---

## Security Considerations

### API Key Storage
- Stored in OS-specific config directories with file permissions
- No encryption at rest (same model as AWS CLI, npm)
- Keys masked in setup output (`****xxxx`)

### Isolated Home Cleanup
- Temporary directories cleaned up in `finally` block
- If cleanup fails (process crash), OS will clean `/tmp` on reboot

### Environment Variables
- Isolated home prevents credential leakage between modes
- MCP OAuth tokens are preserved (selective copy)
- Claude.ai session tokens are excluded in API key modes

### Process Isolation
- Each launch is independent
- No daemon or background process
- Environment changes don't persist after exit

---

## Development Commands

```bash
# Development (uses Bun runtime)
bun run dev setup
bun run dev launch kimi

# Type checking (TypeScript)
bun run typecheck

# Build all platform binaries
bun run build

# Run compiled binary
./dist/flip-cc-linux-x64 --help
```

---

## Troubleshooting

### "Auth conflict" warning
- **Cause:** `ANTHROPIC_API_KEY` set while claude.ai session exists
- **Fix:** Use the appropriate launch mode (don't mix subscription + API key)

### MCP servers not connected in Kimi mode
- **Cause:** `mcpOAuth` not copied properly
- **Fix:** Check if credentials file exists and is readable

### Theme/setup prompts appearing
- **Cause:** `~/.claude.json` not copied to isolated home
- **Fix:** Check file permissions on original config

### PATH warnings
- **Cause:** `~/.local/bin` doesn't exist in isolated home
- **Fix:** Already handled - directory created automatically
