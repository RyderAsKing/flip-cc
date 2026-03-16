# Profile System

Profiles are the central abstraction in flip-cc. Each profile is a named, self-contained configuration that specifies which AI provider to use, how to authenticate, and what environment variables to set when launching Claude Code.

---

## Profile fields

```typescript
interface Profile {
  id: string;                           // Unique identifier
  name: string;                         // Human-readable display name
  provider: ProviderType;               // See provider types below
  apiKey: string;                       // API key (empty for Anthropic subscription)
  baseUrl?: string;                     // Custom API base URL
  model?: string;                       // Model identifier
  extraEnv?: Record<string, string>;    // Additional environment variables
  description?: string;                 // Optional description
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Alphanumeric, dashes, and underscores only. Used on the command line: `flip-cc launch <id>`. |
| `name` | Yes | Shown in `profile list` and interactive selectors. |
| `provider` | Yes | Determines which environment variables are set. |
| `apiKey` | Yes | Empty string for Anthropic subscription mode. |
| `baseUrl` | No | Overrides the provider's default base URL. |
| `model` | No | Sets `ANTHROPIC_MODEL` for providers that require explicit model selection. |
| `extraEnv` | No | Arbitrary additional variables injected into the Claude Code process. Keys must match `[A-Za-z_][A-Za-z0-9_]*` and cannot be `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, or `DYLD_LIBRARY_PATH`. |
| `description` | No | Shown in `profile list`. |

---

## The built-in profile

On first run, flip-cc creates a default `claude` profile for Anthropic subscription mode:

```json
{
  "id": "claude",
  "name": "Claude (Subscription)",
  "provider": "anthropic",
  "apiKey": ""
}
```

This profile uses your claude.ai session (stored in `~/.claude/.credentials.json`) and does not require an API key. It is set as the default profile, so `flip-cc launch` without arguments launches it.

---

## Provider types

flip-cc supports four provider types. Each has pre-configured defaults that are applied automatically when you create a profile via `profile add`.

| Provider | `provider` value | Default base URL | Default model | Auto-set extra env |
|----------|-----------------|------------------|---------------|--------------------|
| Anthropic | `anthropic` | (none — uses Claude Code's built-in default) | (none) | (none) |
| Moonshot Kimi | `kimi` | `https://api.kimi.com/coding/` | `kimi-for-coding` | `ENABLE_TOOL_SEARCH=false` |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | (none — user selects) | `HTTP_REFERER=https://github.com/flip-cc`, `X_TITLE=flip-cc` |
| OpenAI-compatible | `openai-compatible` | (user-provided) | (user-provided, optional) | (none) |

### Environment variables set per provider

**Anthropic (subscription)**
- `ANTHROPIC_API_KEY` is explicitly unset (deleted from the child process environment) to prevent conflicts with any system-wide key.

**Anthropic (API key, with `--key` flag)**
- `ANTHROPIC_API_KEY=<your-key>`
- `ANTHROPIC_BASE_URL=<baseUrl>` (if set on the profile)
- `ANTHROPIC_MODEL=<model>` (if set on the profile)

**Kimi**
- `ANTHROPIC_API_KEY=<kimi-key>`
- `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`
- `ANTHROPIC_MODEL=kimi-for-coding`
- `ENABLE_TOOL_SEARCH=false`

**OpenRouter**
- `ANTHROPIC_API_KEY=<openrouter-key>`
- `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`
- `HTTP_REFERER=https://github.com/flip-cc`
- `X_TITLE=flip-cc`

**OpenAI-compatible**
- Launched via a local proxy (see [architecture.md](./architecture.md)).
- `ANTHROPIC_API_KEY=<per-session-proxy-token>`
- `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxy-port>`

---

## Profile commands

### List all profiles

```bash
flip-cc profile list
```

Displays all profiles with their IDs, names, providers, and masked API keys (first 4 and last 4 characters visible). The default profile is marked.

### Add a profile

```bash
flip-cc profile add
```

Fully interactive. Prompts for all fields relevant to the selected provider. Provider-specific defaults (base URL, model, extra env) are pre-filled and can be accepted or overridden.

### Edit a profile

```bash
flip-cc profile edit           # Interactive profile selector
flip-cc profile edit kimi      # Edit directly by ID
```

Presents the same prompts as `add`, with current values as defaults. Only changed fields are updated.

### Remove a profile

```bash
flip-cc profile remove         # Interactive selector
flip-cc profile remove kimi    # Remove directly by ID
```

Asks for confirmation before deleting. If the removed profile was the default, the default is cleared.

### Set the default profile

```bash
flip-cc profile set-default          # Interactive selector
flip-cc profile set-default kimi     # Set directly by ID
```

The default profile is used when you run `flip-cc launch` without a profile argument.

---

## The `--key` flag for Anthropic profiles

Anthropic profiles support two launch modes:

| Mode | Command | Behaviour |
|------|---------|-----------|
| Subscription | `flip-cc launch claude` | Uses claude.ai OAuth session; `ANTHROPIC_API_KEY` is removed from the environment. |
| API key | `flip-cc launch claude --key` | Sets `ANTHROPIC_API_KEY` from the profile; creates an isolated home directory to avoid credential conflicts. |

If an Anthropic profile has no API key stored, the `--key` flag has no effect.

---

## Configuration storage

Profiles are stored in a JSON file managed by the `conf` library:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Preferences/flip-cc-nodejs/config.json` |
| Linux | `~/.config/flip-cc-nodejs/config.json` |
| Windows | `%APPDATA%\flip-cc-nodejs\config.json` |

On Linux, `$XDG_CONFIG_HOME` is respected if set.

Example `config.json`:

```json
{
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

---

## Migration from v0.2.x

flip-cc v0.3.0 replaced the flat `claudeAuthMode` / `anthropicApiKey` / `kimiApiKey` fields with the profile system. Migration runs automatically on first launch after upgrading.

### What the migrator does

1. Checks whether profiles already exist. If so, migration is skipped (idempotent).
2. Creates profiles from the legacy fields:

| Legacy config | Created profile |
|---------------|-----------------|
| `claudeAuthMode: 'subscription'` | `claude` — Anthropic, no API key |
| `claudeAuthMode: 'api-key'` + `anthropicApiKey` | `claude-api` — Anthropic with API key |
| `kimiApiKey` present | `kimi` — Kimi provider with standard defaults |

3. If no legacy data is found, creates a default `claude` subscription profile as a fallback.
4. Backs up the original config to `config.json.backup` before writing.
5. Sets the first created profile as the default.

Legacy fields remain in the config file after migration and are otherwise ignored.
