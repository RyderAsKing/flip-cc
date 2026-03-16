# Technical Documentation

This document provides detailed technical information about flip-cc's architecture, implementation, and design decisions.

For a quick overview see [getting-started.md](./getting-started.md); for provider/profile details see [profiles.md](./profiles.md); for VSCode see [vscode-integration.md](./vscode-integration.md); for a developer deep-dive see [architecture.md](./architecture.md).

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Profile System](#profile-system)
3. [Authentication Flow](#authentication-flow)
4. [Environment Isolation](#environment-isolation)
5. [Configuration Migration](#configuration-migration)
6. [VSCode Extension Integration](#vscode-extension-integration)
7. [Provider Implementations](#provider-implementations)
8. [Proxy Mechanism](#proxy-mechanism)
9. [Security Considerations](#security-considerations)
10. [Error Handling](#error-handling)
11. [Development Guide](#development-guide)

---

## Architecture Overview

flip-cc is a TypeScript CLI application compiled to standalone binaries using Bun. It wraps the official `claude-code` CLI and provides profile-based provider switching.

### Core Components

```
src/
├── index.ts                 # CLI entry point using Commander.js
├── types.ts                 # TypeScript type definitions
├── commands/
│   ├── setup.ts            # Interactive setup wizard
│   ├── launch.ts           # Environment isolation and process spawning
│   ├── vscode-config.ts    # VSCode settings.json manipulation
│   └── profile.ts          # Profile CRUD operations
└── lib/
    ├── config.ts           # Configuration storage (conf library)
    ├── profiles.ts         # Profile management utilities
    ├── spawn.ts            # Child process spawning with stdio inheritance
    └── validate.ts         # Input validation utilities
```

### Data Flow

1. User invokes `flip-cc launch <profile>`
2. Configuration is loaded from OS-specific store (via `conf` library)
3. Legacy config migration runs if needed (`needsMigration()` check)
4. Profile is resolved (explicit ID → default profile)
5. Profile is validated for readiness
6. Environment overrides are built based on provider type
7. Isolated home directory is created if using API key mode
8. `claude` process is spawned with modified environment
9. Cleanup runs when process exits (temp home removal)

---

## Profile System

Profiles are the core abstraction in flip-cc v0.3.0+. Each profile represents a complete configuration for launching Claude Code with a specific provider.

### Profile Schema

```typescript
interface Profile {
  id: string;                    // Unique identifier (alphanumeric, dashes, underscores)
  name: string;                  // Human-readable display name
  provider: ProviderType;        // 'anthropic' | 'kimi' | 'openrouter' | 'openai-compatible'
  apiKey: string;                // API key (empty for Anthropic subscription mode)
  baseUrl?: string;              // Optional custom API base URL
  model?: string;                // Optional model identifier
  extraEnv?: Record<string, string>;  // Additional environment variables
  description?: string;          // Optional description
}
```

### Profile Storage

Profiles are stored in the `conf` library's configuration file:

- **macOS:** `~/Library/Preferences/flip-cc-nodejs/config.json`
- **Linux:** `~/.config/flip-cc-nodejs/config.json`
- **Windows:** `%APPDATA%/flip-cc-nodejs/config.json`

Example configuration:
```json
{
  "claudeAuthMode": "subscription",
  "anthropicApiKey": "",
  "kimiApiKey": "",
  "setupComplete": true,
  "profiles": [
    {
      "id": "claude",
      "name": "Claude (Subscription)",
      "provider": "anthropic",
      "apiKey": ""
    },
    {
      "id": "kimi",
      "name": "Moonshot Kimi 2.5",
      "provider": "kimi",
      "apiKey": "sk-...",
      "baseUrl": "https://api.kimi.com/coding/",
      "model": "kimi-for-coding",
      "extraEnv": {
        "ENABLE_TOOL_SEARCH": "false"
      }
    }
  ],
  "defaultProfile": "claude"
}
```

### Profile Operations

All profile operations are available via the `profile` subcommand:

| Command | Description |
|---------|-------------|
| `profile list` | Display all profiles with masked API keys |
| `profile add` | Interactive wizard to create a new profile |
| `profile edit [id]` | Edit an existing profile (interactive if no ID) |
| `profile remove [id]` | Remove a profile with confirmation |
| `profile set-default [id]` | Set the default profile for `launch` without args |

---

## Authentication Flow

### Provider Types

#### 1. Anthropic (Subscription Mode)
- **Use Case:** User has claude.ai Pro/Max subscription
- **API Key:** Empty string
- **Environment:** `ANTHROPIC_API_KEY=undefined` (prevents conflicts with env vars)
- **Isolated Home:** No (uses real home directory)

#### 2. Anthropic (API Key Mode)
- **Use Case:** User has Anthropic API key
- **API Key:** `sk-ant...`
- **Environment:** `ANTHROPIC_API_KEY=<key>`
- **Isolated Home:** Yes (requires `--key` flag)

#### 3. Moonshot Kimi
- **Use Case:** User wants to use Kimi 2.5 model
- **API Key:** Kimi API key
- **Environment:**
  - `ANTHROPIC_API_KEY=<kimi-key>`
  - `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`
  - `ENABLE_TOOL_SEARCH=false`
- **Isolated Home:** Yes

#### 4. OpenRouter
- **Use Case:** Access multiple models through OpenRouter
- **API Key:** `sk-or-v1-...`
- **Environment:**
  - `ANTHROPIC_API_KEY=<openrouter-key>`
  - `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`
  - `HTTP_REFERER=https://github.com/flip-cc`
  - `X_TITLE=flip-cc`
- **Isolated Home:** Yes

#### 5. OpenAI-Compatible
- **Use Case:** Custom OpenAI-compatible endpoint (local LLM, etc.)
- **API Key:** Provider-specific
- **Environment:**
  - `ANTHROPIC_API_KEY=<api-key>`
  - `ANTHROPIC_BASE_URL=<custom-url>`
  - Optional: `ANTHROPIC_MODEL=<model>`
- **Isolated Home:** Yes

### Auth Conflict Prevention

The core problem: Claude Code stores claude.ai session tokens in `~/.claude/.credentials.json`. When `ANTHROPIC_API_KEY` is also present, Claude Code detects an "Auth conflict" and refuses to start.

**Solution:** Environment isolation (see [Environment Isolation](#environment-isolation)).

---

## Environment Isolation

For API key modes, flip-cc creates a temporary isolated home directory to prevent auth conflicts while preserving user settings.

### Directory Structure

```
/tmp/.fcc-XXXXXX/
├── .claude.json                    # Copied from real home
├── .claude/
│   ├── settings.json               # Copied from real home
│   ├── themes/                     # Copied from real home
│   └── .credentials.json           # Generated (MCP OAuth only)
└── .local/
    └── bin/
        └── claude → /usr/local/bin/claude  # Symlink to real binary
```

### Isolation Process

1. **Create temp directory:** `mkdtempSync(join(tmpdir(), '.fcc-'))`
2. **Copy `.claude.json`:** Main config file (themes, settings)
3. **Copy `.claude/` contents:** Everything except `.credentials.json`
4. **Filter credentials:** Create new `.credentials.json` with only:
   - `mcpOAuth` (preserves Figma, etc.)
   - `organizationUuid` (if present)
5. **Create symlink:** Link `~/.local/bin/claude` to real binary
6. **Set environment:**
   - `HOME=<temp-dir>`
   - `PATH=<temp-dir>/.local/bin:<original-path>`
   - `USERPROFILE=<temp-dir>` (Windows)

### Cleanup

The temp directory is removed in a `finally` block after the Claude process exits, ensuring cleanup even on crashes or SIGINT.

---

## Configuration Migration

When upgrading from v0.2.x to v0.3.0+, flip-cc automatically migrates legacy configuration to the new profile system.

### Migration Logic

```typescript
// From src/lib/config.ts
export async function migrateToProfiles(): Promise<boolean> {
  // Check if already migrated
  if (currentConfig.profiles && currentConfig.profiles.length > 0) {
    return false;
  }

  const profiles: Profile[] = [];

  // Migrate Claude subscription mode
  if (currentConfig.claudeAuthMode === 'subscription') {
    profiles.push({
      id: 'claude',
      name: 'Claude (Subscription)',
      provider: 'anthropic',
      apiKey: '',
    });
  }

  // Migrate Claude API key mode
  if (currentConfig.claudeAuthMode === 'api-key' && currentConfig.anthropicApiKey) {
    profiles.push({
      id: 'claude-api',
      name: 'Claude (API Key)',
      provider: 'anthropic',
      apiKey: currentConfig.anthropicApiKey,
    });
  }

  // Migrate Kimi
  if (currentConfig.kimiApiKey) {
    profiles.push({
      id: 'kimi',
      name: 'Moonshot Kimi 2.5',
      provider: 'kimi',
      apiKey: currentConfig.kimiApiKey,
      baseUrl: 'https://api.kimi.com/coding/',
      model: 'kimi-for-coding',
      extraEnv: { ENABLE_TOOL_SEARCH: 'false' },
    });
  }

  // Fallback: create default profile if nothing migrated
  if (profiles.length === 0) {
    profiles.push({
      id: 'claude',
      name: 'Claude (Subscription)',
      provider: 'anthropic',
      apiKey: '',
    });
  }

  // Backup and save
  backupConfig();
  setConfig({ profiles, defaultProfile: profiles[0]?.id });

  return true;
}
```

### Migration Mapping

| Legacy Config | New Profile |
|--------------|-------------|
| `claudeAuthMode: 'subscription'` | `claude` profile (Anthropic, no API key) |
| `claudeAuthMode: 'api-key'` + `anthropicApiKey` | `claude-api` profile (Anthropic, with API key) |
| `kimiApiKey` | `kimi` profile (Kimi provider) |

### Safety Measures

1. **Backup created:** Original config saved as `config.json.backup`
2. **Old fields preserved:** Legacy fields remain in config for safety
3. **Idempotent:** Migration only runs once (checks for existing profiles)
4. **Atomic:** Profile array is written in a single operation

---

## VSCode Extension Integration

flip-cc can configure the official Claude Code VSCode extension to use any configured profile.

### How It Works

Instead of PATH manipulation or binary shims, flip-cc writes directly to VSCode's `settings.json`:

```json
{
  "claudeCode.environmentVariables": [
    { "name": "ANTHROPIC_API_KEY", "value": "sk-..." },
    { "name": "ANTHROPIC_BASE_URL", "value": "https://api.kimi.com/coding/" },
    { "name": "ENABLE_TOOL_SEARCH", "value": "false" }
  ],
  "claudeCode.disableLoginPrompt": true
}
```

### Settings.json Locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |
| Windows | `%APPDATA%/Code/User/settings.json` |

### Update Strategy

The update uses a **line-based parsing approach** to preserve user settings:

1. **Backup:** Original saved as `settings.json.flip-cc.bak`
2. **Remove old:** Line-based removal of `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt`
3. **Insert new:** New block inserted before final closing brace
4. **Comma handling:** Smart detection of whether comma is needed before insertion

This approach preserves:
- User comments (if any)
- JSON formatting and indentation
- Other VSCode settings

### Profile Selection

The VSCode config wizard shows all configured profiles with descriptions:

```
? Which profile would you like to use in VSCode?
  > Claude (Subscription) [default]
    Moonshot Kimi 2.5
    OpenRouter Claude Sonnet
    Local LLM Server
```

---

## Provider Implementations

### Provider Base URLs

| Provider | Default Base URL |
|----------|------------------|
| `anthropic` | (none - uses Claude Code default) |
| `kimi` | `https://api.kimi.com/coding/` |
| `openrouter` | `https://openrouter.ai/api/v1` |
| `openai-compatible` | (user-provided) |

### Provider Extra Environment Variables

| Provider | Extra Env Vars |
|----------|----------------|
| `kimi` | `ENABLE_TOOL_SEARCH: 'false'` |
| `openrouter` | `HTTP_REFERER: 'https://github.com/flip-cc'`, `X_TITLE: 'flip-cc'` |
| `anthropic`, `openai-compatible` | (none) |

### Provider Default Models

| Provider | Default Model |
|----------|---------------|
| `kimi` | `kimi-for-coding` |
| `anthropic` | (none - uses Claude Code default) |
| `openrouter` | (none - user must select) |
| `openai-compatible` | (optional) |

---

## Proxy Mechanism

The built-in proxy is used exclusively for `openai-compatible` profiles. It bridges Claude Code's Anthropic Messages API calls to OpenAI Chat Completions-format endpoints.

### Why it exists

Claude Code sends requests in Anthropic Messages API format. OpenAI-compatible endpoints expect OpenAI Chat Completions format. These differ in request structure, response shape, and streaming event format (Anthropic SSE vs. OpenAI SSE). A translation layer running locally bridges the two protocols transparently.

### How it works

`needsProxy(profile)` returns `true` when `profile.provider === 'openai-compatible'`. When true, `launchCommand` calls `startProxy(profile)` before creating the isolated home directory.

`startProxy`:

1. Generates a fresh per-session `authToken` in `sk-ant-proxy-<64-random-bytes>` format. The `sk-ant-` prefix satisfies Claude Code's API key validation; the 64 random bytes provide 512 bits of entropy.
2. Starts a Bun HTTP server bound to `127.0.0.1:0`. Port `0` lets the OS assign an available port atomically, avoiding any time-of-check/time-of-use race.
3. Returns a `ProxyHandle` containing `{ port, baseUrl, authToken, stop }`.

`launchCommand` then:
- Sets `ANTHROPIC_BASE_URL = http://127.0.0.1:<port>` (overriding any profile `baseUrl`)
- Sets `ANTHROPIC_API_KEY = authToken`
- Passes `authToken` as the key to pre-approve in `~/.claude.json` (so Claude Code skips the "Detected a custom API key" dialog)

### Request handling

The proxy handler verifies every request by checking `x-api-key` or `Authorization: Bearer` against `authToken` and returns 401 on mismatch. It then:

- Translates `POST /v1/messages` (Anthropic) → `POST <profile.baseUrl>/chat/completions` (OpenAI) using `anthropicToOpenAI` from `proxy-convert.ts`
- Authenticates to the upstream endpoint using `profile.apiKey` in `Authorization: Bearer`
- Converts the upstream response back to Anthropic format (`openAIToAnthropic` for non-streaming; `openAIStreamChunkToAnthropic` for SSE streaming)
- Handles `GET /v1/models` with a minimal model list response

### Cleanup

`proxyHandle.stop()` (which calls `server.stop(true)`) is called in the `finally` block of `launchCommand`, ensuring the server shuts down even if the `claude` process exits unexpectedly.

### VSCode limitation

The proxy only runs during a `flip-cc launch` session. The VSCode extension starts independently, so `openai-compatible` profiles cannot be configured via `flip-cc vscode-config`.

---

## Security Considerations

### API Key Storage

- Keys are stored using the `conf` library, which uses OS-specific secure storage
- Config file permissions are set by the OS (typically user-only read/write)
- Keys are never logged or transmitted
- Masked display in `profile list` (shows only first 4 and last 4 characters)

### Isolated Home Directory

- Temp directories are created with random suffixes (`.fcc-XXXXXX`)
- Directories are removed after use (cleanup in `finally` block)
- Symlinks are validated before creation

### VSCode Settings

- API keys are written to `settings.json` in plain text (same as storing in env vars)
- Backup is created before modification
- Only flip-cc managed keys are modified

### Process Spawning

- Uses `stdio: 'inherit'` for full terminal passthrough
- Environment overrides are explicit and scoped to child process only
- Signals are forwarded properly (`SIGINT`, `SIGTERM`)

---

## Error Handling

### Validation Errors

```typescript
// API key validation
validateApiKey('invalid-key', 'anthropic')
// Returns: 'Anthropic API key must start with "sk-ant"'

// Profile validation
validateProfileReady('nonexistent')
// Returns: 'Profile "nonexistent" not found. Run "flip-cc profile list"...'
```

### Launch Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Profile not found" | Invalid profile ID | Run `flip-cc profile list` |
| "API key is required" | Profile missing API key | Run `flip-cc profile edit <id>` |
| "claude command not found" | Claude Code not installed | `npm install -g @anthropic-ai/claude-code` |

### Migration Errors

If migration fails:
1. Original config is preserved at `config.json.backup`
2. Error is logged to stderr
3. User can manually restore if needed

---

## Development Guide

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Git

### Setup

```bash
git clone https://github.com/RyderAsKing/flip-cc.git
cd flip-cc
bun install
```

### Development Commands

```bash
# Run with hot reload
bun run dev setup
bun run dev launch kimi
bun run dev profile list

# Type check
bun run typecheck

# Build binaries
bun run build
```

### Testing

```bash
# Build first
bun run build

# Test specific binary
./dist/flip-cc-linux-x64 setup
./dist/flip-cc-linux-x64 profile list

# Simulate fresh install
rm -rf ~/.config/flip-cc-nodejs
./dist/flip-cc setup
```

### Debugging

```bash
# Check config location
./dist/flip-cc profile list
# Config path is shown in output

# View raw config
cat ~/.config/flip-cc-nodejs/config.json | jq .

# Check VSCode settings
cat ~/.config/Code/User/settings.json | jq '.claudeCode'
```

### Build Output

The build script (`build.ts`) produces:

```
dist/
├── flip-cc-linux-x64
├── flip-cc-macos-x64
├── flip-cc-macos-arm64
├── flip-cc-windows-x64.exe
└── flip-cc -> flip-cc-linux-x64  (symlink for current platform)
```

### Code Style

- **Imports:** Use `.js` extension for relative imports (TypeScript ESM requirement)
- **Types:** Explicit return types on exported functions
- **Error handling:** Try-catch with graceful degradation
- **Chalk:** Use for all colored output

---

## Future Considerations

### Potential Enhancements

1. **Encrypted Config:** Add optional encryption for API keys at rest
2. **Profile Import/Export:** Share profiles between machines
3. **Cloud Sync:** Optional encrypted cloud backup of profiles
4. **Plugin System:** Allow custom providers via plugins
5. **GUI:** Desktop application for profile management

### Known Limitations

1. **VSCode Plain Text:** API keys in `settings.json` are visible to any process with user permissions
2. **No Key Rotation:** No automatic key rotation or expiration
3. **Single Default:** Only one default profile (no per-directory defaults)
4. **Windows Support:** Limited Windows testing (WSL recommended)
