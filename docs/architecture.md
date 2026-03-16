# Architecture

This document is intended for developers contributing to flip-cc or auditing its internals.

---

## Project structure

```
flip-cc/
├── src/
│   ├── index.ts                   # CLI entry point; Commander.js program definition
│   ├── types.ts                   # Shared TypeScript types (Profile, ProviderType, AppConfig, etc.)
│   ├── commands/
│   │   ├── launch.ts              # Environment isolation, proxy orchestration, process spawn
│   │   ├── profile.ts             # Profile CRUD commands (interactive prompts)
│   │   ├── vscode-config.ts       # VSCode settings.json read/write
│   │   └── setup/
│   │       ├── index.ts           # Setup wizard entry point
│   │       ├── anthropic.ts       # Anthropic setup flow
│   │       ├── kimi.ts            # Kimi setup flow
│   │       ├── openrouter.ts      # OpenRouter setup flow
│   │       └── openai-compatible.ts  # OpenAI-compatible setup flow
│   └── lib/
│       ├── config.ts              # conf-based config wrapper; migration logic
│       ├── profiles.ts            # Profile CRUD helpers; provider defaults
│       ├── proxy.ts               # Local HTTP proxy (Anthropic ↔ OpenAI format bridge)
│       ├── proxy-convert.ts       # Request/response format conversion functions
│       ├── spawn.ts               # child_process wrapper with stdio inheritance and signal forwarding
│       ├── utils.ts               # maskApiKey, getProviderDisplay, etc.
│       └── validate.ts            # API key format validation; profile readiness checks
├── build.ts                       # Bun compile script (4 binary targets)
├── install.sh                     # One-line installer (Linux/macOS)
├── uninstall.sh                   # Uninstaller script
├── upgrade.sh                     # Upgrade script (backup → reinstall → restore)
└── docs/                          # This documentation
```

### File responsibilities

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Registers all `Command` objects; delegates to command modules. |
| `src/types.ts` | Single source of truth for `Profile`, `ProviderType`, `AuthMode`, `AppConfig`, `LaunchTarget`. |
| `src/commands/launch.ts` | Orchestrates the full launch flow: migration → profile resolution → env build → proxy → isolated home → spawn → cleanup. |
| `src/commands/profile.ts` | Interactive `@inquirer/prompts` flows for `list`, `add`, `edit`, `remove`, `set-default`. |
| `src/commands/vscode-config.ts` | Reads/writes `settings.json`; manages backup; detects VSCode settings path per platform. |
| `src/lib/config.ts` | Wraps the `conf` library; exposes typed `getConfig`/`setConfig`; implements `migrateToProfiles`. |
| `src/lib/profiles.ts` | Pure functions over the profile array in config: `getProfile`, `addProfile`, `updateProfile`, `removeProfile`, `setDefaultProfile`, provider defaults (`getProviderBaseUrl`, `getProviderDefaultModel`, `getProviderExtraEnv`). |
| `src/lib/proxy.ts` | `needsProxy`, `startProxy`, HTTP handler, SSE stream converter. |
| `src/lib/proxy-convert.ts` | Stateless conversion between Anthropic Messages API format and OpenAI Chat Completions format. |
| `src/lib/spawn.ts` | `spawnWithInheritance`: wraps `child_process.spawn` with `stdio: 'inherit'`, env overrides, and signal forwarding. |
| `src/lib/validate.ts` | `validateApiKey` (prefix checks per provider), `validateProfileReady` (API key present, base URL for openai-compatible). |

---

## Data flow: `flip-cc launch <profile>`

```
1. User invokes: flip-cc launch kimi
       |
2. index.ts → launchCommand('kimi', { key: false })
       |
3. needsMigration() → migrateToProfiles() if upgrading from v0.2.x
       |
4. initializeDefaultProfiles() — ensures at least one profile exists
       |
5. getProfile('kimi') — look up profile by ID
   if not found → getDefaultProfileId() → fallback to default
   if still not found → error and exit
       |
6. validateProfileReady(profile.id)
   - checks apiKey is present if required
   - checks baseUrl is present for openai-compatible
       |
7. buildEnvOverrides(profile, options)
   - sets ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL
   - applies and validates extraEnv
   - blocks dangerous linker variables
       |
8. needsProxy(profile) → true for 'openai-compatible'
   if true → startProxy(profile)
     - generates per-session authToken (sk-ant-proxy-<64-random-bytes>)
     - starts Bun HTTP server on 127.0.0.1:0 (OS-assigned port)
     - overrides ANTHROPIC_BASE_URL → http://127.0.0.1:<port>
     - overrides ANTHROPIC_API_KEY → authToken
       |
9. needsIsolatedHome(profile, options) → true when API key mode
   if true → createIsolatedHomeForApiKey(apiKeyOrProxyToken)
     - mkdtempSync('/tmp/.fcc-XXXXXX')  [chmod 700]
     - setupLocalBinSymlink: creates .local/bin/claude → real binary
     - setupClaudeJsonConfig: copies ~/.claude.json, injects key into
         customApiKeyResponses.approved (skips interactive dialog)
     - setupClaudeDir: copies ~/.claude/ except .credentials.json,
         then writes filtered credentials (mcpOAuth + organizationUuid only)
     - sets HOME, PATH (prepends .local/bin), USERPROFILE (Windows)
       |
10. spawnWithInheritance('claude', [], { envOverrides })
    - stdio: 'inherit' → full terminal passthrough
    - SIGINT/SIGTERM forwarded to child process
    - awaits process exit
       |
11. finally block:
    - proxyHandle.stop() if proxy was started
    - rmSync(isolatedHome, { recursive: true, force: true })
```

---

## Environment isolation

### Why it is needed

Claude Code stores a claude.ai session token in `~/.claude/.credentials.json` under the key `claudeAiOauth`. If `ANTHROPIC_API_KEY` is set in the same environment, Claude Code detects an auth conflict and refuses to start with an error message.

The solution is to give the child process a `$HOME` that contains no `claudeAiOauth` credential, so it sees only the API key and has no conflicting session to reconcile.

### `createIsolatedHomeForApiKey()` step by step

**1. Create temp directory**

```typescript
const tempHome = mkdtempSync(join(tmpdir(), '.fcc-'));
chmodSync(tempHome, 0o700);
```

`tmpdir()` returns `/tmp` on Linux/macOS or `%TEMP%` on Windows. The directory name is `.fcc-` followed by a random suffix generated by the OS. Permissions are immediately restricted to owner-only (read/write/execute = 700) regardless of the system umask.

**2. Create `~/.local/bin/claude` symlink**

```typescript
const realClaudePath = execSync('which claude').trim();
symlinkSync(realClaudePath, join(tempHome, '.local', 'bin', 'claude'));
```

Claude Code validates its own installation by checking for the `claude` binary on `PATH`. With `HOME` redirected, `PATH` is also updated to prepend `<tempHome>/.local/bin`, so the symlink satisfies this check.

**3. Copy `~/.claude.json` and pre-approve the API key**

```typescript
cpSync(join(realHome, '.claude.json'), join(tempHome, '.claude.json'));
claudeConfig.customApiKeyResponses = {
  ...claudeConfig.customApiKeyResponses,
  approved: [...existingApproved, apiKey],
};
writeFileSync(join(tempHome, '.claude.json'), JSON.stringify(claudeConfig, null, 2));
```

`~/.claude.json` stores user preferences (themes, editor settings). It is copied so the user's configuration is preserved. The API key is then added to `customApiKeyResponses.approved` to suppress the interactive "Detected a custom API key" confirmation dialog that Claude Code shows the first time it sees a new key.

When the proxy is in use, the per-session proxy token is approved here (not the real API key), since that is what Claude Code actually sees.

**4. Copy `~/.claude/` directory, filtering credentials**

All files and subdirectories in `~/.claude/` are copied except `.credentials.json`. Then a new `.credentials.json` is written containing only:

- `mcpOAuth` — OAuth tokens for MCP servers (e.g., Figma). Preserving this keeps MCP integrations working.
- `organizationUuid` — Included if present; may be required for some Claude Code features.

`claudeAiOauth` (the claude.ai session token) is excluded. Without it, Claude Code does not detect a conflicting session.

**5. Set environment variables**

```typescript
envOverrides['HOME'] = tempHome;
envOverrides['PATH'] = `${tempHome}/.local/bin${delimiter}${process.env.PATH}`;
envOverrides['USERPROFILE'] = tempHome;  // Windows only
```

### Fresh system handling

On a completely fresh system where `~/.claude/` does not yet exist (no prior Claude Code installation), flip-cc ensures Claude Code does not trigger its first-run onboarding prompts:

- **`setupClaudeDir()`** always creates `~/.claude/` and an empty `.credentials.json` (`{}`) in the isolated home, even when there is no real `~/.claude/` to copy from. Claude Code uses the presence of this directory and credentials file to determine whether it is a first run.
- **`setupClaudeJsonConfig()`** sets `hasCompletedOnboarding: true` in the isolated `~/.claude.json`, suppressing onboarding dialogs.
- **`vscode-config` command** bootstraps `~/.claude/` and `.credentials.json` in the **real** `$HOME` when configuring API key mode, since the VSCode extension does not use an isolated home directory.

**Cleanup**

After the `claude` child process exits (for any reason, including SIGINT), the temp directory is removed with `rmSync(isolatedHome, { recursive: true, force: true })` inside a `finally` block. A warning is printed to stderr if cleanup fails, since an abandoned temp directory may contain copies of `~/.claude/` configuration files.

### Temp directory structure

This structure is always created, even on fresh systems where `~/.claude/` does not exist. On fresh systems, `.claude/` contains only the empty `.credentials.json` and `.claude.json` contains the onboarding flag and key approval.

```
/tmp/.fcc-XXXXXX/           [chmod 700]
├── .claude.json             # Copied from ~; API key pre-approved; hasCompletedOnboarding
├── .claude/
│   ├── settings.json        # Copied from ~/.claude/ (if exists)
│   ├── themes/              # Copied from ~/.claude/ (if exists)
│   └── .credentials.json    # Generated; mcpOAuth + organizationUuid only (or {} on fresh systems)
└── .local/
    └── bin/
        └── claude           # Symlink → /usr/local/bin/claude (or wherever)
```

---

## The proxy mechanism

The proxy is used exclusively for `openai-compatible` profiles (`needsProxy` returns `true` only for that provider type).

### Why a proxy is needed

Claude Code speaks the Anthropic Messages API. OpenAI-compatible endpoints speak the OpenAI Chat Completions API. These formats differ in request structure, response shape, and streaming event format. A translation layer is required.

### How `startProxy` works

```typescript
const authToken = `sk-ant-proxy-${randomBytes(64).toString('base64url')}`;
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: makeHandler(profile, authToken) });
const baseUrl = `http://127.0.0.1:${server.port}`;
```

1. A cryptographically random `authToken` is generated in `sk-ant-*` format (satisfies Claude Code's API key prefix validation) fresh each session.
2. Bun's built-in HTTP server is started on `127.0.0.1:0`. Port 0 lets the OS assign an available port atomically, avoiding TOCTOU races.
3. `ANTHROPIC_BASE_URL` is set to `http://127.0.0.1:<port>` and `ANTHROPIC_API_KEY` is set to `authToken`. Claude Code sends all API requests to the local proxy.

### Request handling

The proxy handler:

1. **Authenticates** every request by checking `x-api-key` or `Authorization: Bearer` against the per-session `authToken`. Returns 401 if the token does not match (guards against DNS rebinding and local process snooping).
2. **Translates** `POST /v1/messages` (Anthropic format) to `POST <baseUrl>/chat/completions` (OpenAI format) using `anthropicToOpenAI` from `proxy-convert.ts`.
3. **Sends** the translated request to the upstream endpoint using the actual `profile.apiKey` in `Authorization: Bearer`.
4. **Converts** the response back to Anthropic format (`openAIToAnthropic` for non-streaming, `openAIStreamChunkToAnthropic` for SSE streaming).
5. Also handles `GET /v1/models` with a minimal model list.

### Cleanup

`proxyHandle.stop()` is called in the `finally` block of `launchCommand`, which calls `server.stop(true)` to gracefully shut down the Bun HTTP server.

---

## Security

### Blocked environment variable keys

The following keys are rejected from `extraEnv` in any profile, with a warning printed to stderr:

| Key | Risk |
|-----|------|
| `LD_PRELOAD` | Injects arbitrary shared libraries into the `claude` process (Linux) |
| `LD_LIBRARY_PATH` | Redirects dynamic linker to attacker-controlled libraries (Linux) |
| `DYLD_INSERT_LIBRARIES` | macOS equivalent of `LD_PRELOAD` |
| `DYLD_LIBRARY_PATH` | macOS equivalent of `LD_LIBRARY_PATH` |

Additionally, all `extraEnv` key names must match the regex `/^[A-Z_][A-Z0-9_]*$/i`. Keys that fail this check are skipped with a warning.

### Other security measures

- **Temp directory permissions:** `chmod 700` immediately after creation.
- **Cleanup in `finally`:** Temp directories are removed even on SIGINT or uncaught errors, preventing sensitive copies of `~/.claude/` from being left behind.
- **Proxy auth token:** Per-session, cryptographically random, discarded on proxy shutdown.
- **Proxy binding:** Binds to `127.0.0.1` (IPv4 loopback only), not `localhost` (which may resolve to `::1` on some systems).
- **API key masking:** `profile list` shows only the first 4 and last 4 characters of each key.
- **VSCode settings permissions:** `settings.json` and its backup are written with `mode: 0o600`.
- **Path traversal guard:** `vscode-config.ts` validates the computed `settings.json` path is inside the expected base directory (home or APPDATA) using `path.relative`.

---

## Configuration schema and storage

The `conf` library is used for all persistent configuration. It stores data as JSON in the OS-specific user config directory with no additional encryption.

```typescript
interface AppConfig {
  claudeAuthMode?: AuthMode;         // Legacy field (pre-v0.3.0)
  anthropicApiKey?: string;          // Legacy field
  kimiApiKey?: string;               // Legacy field
  setupComplete?: boolean;
  profiles?: Profile[];
  defaultProfile?: string;
}
```

Config paths:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Preferences/flip-cc-nodejs/config.json` |
| Linux | `~/.config/flip-cc-nodejs/config.json` (or `$XDG_CONFIG_HOME/flip-cc-nodejs/config.json`) |
| Windows | `%APPDATA%\flip-cc-nodejs\config.json` |

---

## Build system

The build script (`build.ts`) uses Bun's `--compile` flag to produce self-contained binaries that bundle the TypeScript source, all npm dependencies, and the Bun runtime into a single executable.

```bash
bun run build
```

Targets:

| Binary | Target |
|--------|--------|
| `dist/flip-cc-linux-x64` | `bun-linux-x64` |
| `dist/flip-cc-macos-x64` | `bun-darwin-x64` |
| `dist/flip-cc-macos-arm64` | `bun-darwin-arm64` |
| `dist/flip-cc-windows-x64.exe` | `bun-windows-x64` |

A platform-specific symlink (`dist/flip-cc` or `dist/flip-cc.exe`) is also created for the current build host.

---

## Development commands

```bash
# Install dependencies
bun install

# Run TypeScript directly (no compilation step)
bun run dev setup
bun run dev launch kimi
bun run dev profile list

# Type check without running
bun run typecheck

# Build all platform binaries
bun run build
```

---

## Testing approach

flip-cc does not currently have automated tests (except for unit tests of the proxy format conversion functions in `src/lib/proxy-convert.test.ts`). The recommended manual test flow is:

```bash
# Build first
bun run build

# Simulate a fresh install by clearing config
rm -rf ~/.config/flip-cc-nodejs   # Linux
# or: rm -rf ~/Library/Preferences/flip-cc-nodejs   # macOS

# Run setup and verify each flow
./dist/flip-cc setup
./dist/flip-cc profile list
./dist/flip-cc launch kimi
```

### Debugging tips

```bash
# View raw configuration (Linux)
cat ~/.config/flip-cc-nodejs/config.json | jq .

# View raw configuration (macOS)
cat ~/Library/Preferences/flip-cc-nodejs/config.json | jq .

# Check VSCode integration
cat ~/.config/Code/User/settings.json | jq '.["claudeCode.environmentVariables"]'

# Watch temp directories during launch (Linux)
watch -n1 'ls /tmp/.fcc-* 2>/dev/null'
```

---

## Adding a new provider

1. **`src/types.ts`** — Add the new provider value to the `ProviderType` union:
   ```typescript
   export type ProviderType = 'anthropic' | 'kimi' | 'openrouter' | 'openai-compatible' | 'myprovider';
   ```

2. **`src/lib/profiles.ts`** — Add cases in `getProviderBaseUrl`, `getProviderDefaultModel`, and `getProviderExtraEnv` to return the provider's defaults.

3. **`src/commands/launch.ts` → `buildEnvOverrides`** — The existing non-Anthropic branch (`else` block) already sets `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_MODEL` from profile fields. If the new provider needs special handling beyond these three variables, add it here.

4. **`src/lib/proxy.ts` → `needsProxy`** — Return `true` if the provider requires the Anthropic↔OpenAI translation proxy.

5. **`src/commands/vscode-config.ts` → `buildEnvVarsFromProfile`** — If the provider cannot work in VSCode (e.g., requires the proxy), add a guard returning `null`.

6. **`src/lib/validate.ts`** — Add API key format validation for the new provider if it has a recognizable prefix.

7. **`src/commands/profile.ts`** and **`src/commands/setup/`** — Add the provider to interactive selectors and create a setup sub-flow if needed.

---

## Code style

- **Imports:** Use `.js` extensions on all relative imports (TypeScript ESM requirement for Bun bundling).
- **Return types:** Exported functions have explicit return type annotations.
- **Colors:** All user-facing output uses `chalk`. Use `chalk.red` for errors, `chalk.yellow` for warnings, `chalk.blue` for informational messages, `chalk.green` for success.
- **Error handling:** Try-catch with graceful degradation where external operations (file copies, symlink creation) may fail non-fatally. Fatal errors call `process.exit(1)` after logging with `chalk.red`.
- **Async:** `async`/`await` throughout; no callback-style async.
