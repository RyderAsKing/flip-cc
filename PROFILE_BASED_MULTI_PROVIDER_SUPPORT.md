# Profile-Based Multi-Provider Support Implementation Plan

## Context

Currently, flip-cc has hardcoded support for Claude (subscription/API key) and Kimi. The user wants a flexible "work profile" system where they can create custom named profiles like:

- `flip-cc launch claude-pro` → Claude with subscription
- `flip-cc launch claude-api` → Claude with API key
- `flip-cc launch kimi` → Moonshot Kimi
- `flip-cc launch gpt5.4` → Custom profile using OpenRouter with GPT-5.4
- `flip-cc launch my-custom` → Any arbitrary provider/model combination

## Decision: Build Profiles First

**Why profiles before OpenRouter:**

- OpenRouter support would just be another hardcoded provider
- Profiles solve the multi-provider problem generically
- Once profiles exist, OpenRouter becomes "just another profile type"
- Users can have multiple OpenRouter profiles with different models
- No breaking migration needed later

## New Architecture: Work Profiles

### Profile Schema

```typescript
// src/types.ts

export type ProviderType =
  | "anthropic"
  | "kimi"
  | "openrouter"
  | "openai-compatible";

export interface Profile {
  id: string; // Unique identifier (e.g., "claude-pro", "gpt5.4")
  name: string; // Display name (e.g., "Claude Pro", "GPT-5.4")
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string; // Override base URL (for OpenRouter, custom endpoints)
  model?: string; // Model identifier
  extraEnv?: Record<string, string>; // Additional env vars
  description?: string; // Optional description shown in listings
}

export interface AppConfig {
  // Legacy fields (for migration)
  claudeAuthMode?: "subscription" | "api-key";
  anthropicApiKey?: string;
  kimiApiKey?: string;
  openrouterApiKey?: string;
  setupComplete?: boolean;

  // New profile-based config
  profiles: Profile[];
  defaultProfile?: string; // Profile to use if none specified
}
```

### Profile Structure Examples

```typescript
// Built-in/profile-generated configs:

// 1. Claude Subscription (created by default)
{
  id: 'claude',
  name: 'Claude (Subscription)',
  provider: 'anthropic',
  apiKey: '',  // Not used, subscription mode
  // No baseUrl = uses Anthropic default
}

// 2. Claude API Key
{
  id: 'claude-api',
  name: 'Claude (API Key)',
  provider: 'anthropic',
  apiKey: 'sk-ant-api03-...',
}

// 3. Kimi
{
  id: 'kimi',
  name: 'Moonshot Kimi 2.5',
  provider: 'kimi',
  apiKey: '...',
  baseUrl: 'https://api.kimi.com/coding/',
  model: 'kimi-for-coding',
  extraEnv: { ENABLE_TOOL_SEARCH: 'false' }
}

// 4. OpenRouter - Claude Sonnet
{
  id: 'claude-sonnet',
  name: 'Claude 3.5 Sonnet (OpenRouter)',
  provider: 'openrouter',
  apiKey: 'sk-or-v1-...',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'anthropic/claude-3.5-sonnet',
  extraEnv: {
    HTTP_REFERER: 'https://github.com/flip-cc',
    X_TITLE: 'flip-cc'
  }
}

// 5. OpenRouter - GPT-5.4 (user-defined)
{
  id: 'gpt5.4',
  name: 'GPT-5.4',
  provider: 'openrouter',
  apiKey: 'sk-or-v1-...',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-5.4',
  extraEnv: {
    HTTP_REFERER: 'https://github.com/flip-cc',
    X_TITLE: 'flip-cc'
  }
}

// 6. Custom OpenAI-compatible endpoint
{
  id: 'company-internal',
  name: 'Company Internal LLM',
  provider: 'openai-compatible',
  apiKey: '...',
  baseUrl: 'https://llm.internal.company.com/v1',
  model: 'llama-3-70b',
}
```

## New CLI Interface

```bash
# Launch commands - profile ID as target
flip-cc launch claude           # Launch default or "claude" profile
flip-cc launch claude-api       # Launch with API key profile
flip-cc launch kimi             # Launch Kimi profile
flip-cc launch gpt5.4           # Launch custom OpenRouter profile

# Profile management (new commands)
flip-cc profile list            # List all profiles
flip-cc profile add             # Interactive profile creation
flip-cc profile edit <id>       # Edit existing profile
flip-cc profile remove <id>     # Remove profile
flip-cc profile set-default <id> # Set default profile

# Setup becomes profile-aware
flip-cc setup                   # Setup profiles (migrate + create)
```

## Implementation Plan

### Phase 1: Core Profile Infrastructure

**Files:** `src/types.ts`, `src/lib/config.ts`, `src/lib/profiles.ts` (new)

1. **Define types:** `Profile`, `ProviderType`, update `AppConfig`
2. **Create profile management module:** CRUD operations for profiles
3. **Config migration:** On first run, convert existing config to profiles:
   - If `claudeAuthMode === 'subscription'` → create `claude` profile
   - If `claudeAuthMode === 'api-key'` → create `claude-api` profile
   - If `kimiApiKey` exists → create `kimi` profile
4. **Built-in defaults:** Create default profiles if none exist

### Phase 2: Refactor Launch Command

**Files:** `src/commands/launch.ts`

1. Change launch argument from hardcoded target to profile ID lookup
2. Refactor to use profile configuration:
   ```typescript
   export async function launchCommand(
     profileId: string,
     options: LaunchOptions,
   ): Promise<void>;
   ```
3. Provider-specific logic becomes data-driven based on `profile.provider`
4. Environment variable generation from profile config

### Phase 3: New Profile Management Commands

**Files:** `src/commands/profile.ts` (new), `src/index.ts`

1. **`profile list`:** Display all profiles with provider, model, masked API key
2. **`profile add`:** Interactive wizard:
   - Select provider type (Anthropic, Kimi, OpenRouter, OpenAI-compatible)
   - Enter profile ID (validate: alphanumeric + dash/underscore)
   - Enter display name
   - Provider-specific prompts:
     - Anthropic: "Use subscription or API key?"
     - Kimi: API key
     - OpenRouter: API key + model selection (with custom option)
     - OpenAI-compatible: Base URL + API key + model
   - Optional description
3. **`profile edit <id>`:** Same as add but pre-populated
4. **`profile remove <id>`:** Confirm then delete
5. **`profile set-default <id>`:** Set default profile

### Phase 4: Refactor Setup Command

**Files:** `src/commands/setup.ts`

1. Migrate existing config to profiles (one-time)
2. Ask if user wants to:
   - Quick setup (create standard profiles)
   - Custom setup (full profile management)
3. Quick setup flow:
   - Claude: subscription or API key?
   - Add Kimi? (y/n)
   - Add OpenRouter? (y/n) → if yes, pick model

### Phase 5: VSCode Config Update

**Files:** `src/commands/vscode-config.ts`

1. Show list of profiles instead of hardcoded options
2. Selected profile's env vars written to VSCode settings

### Phase 6: OpenRouter Support (Simple Addition)

**Files:** `src/types.ts` (add 'openrouter' to ProviderType)

1. Add 'openrouter' as a `ProviderType`
2. In profile creation, add OpenRouter-specific model picker
3. Default OpenRouter headers in env var generation

**This is now trivial** because the infrastructure supports any provider.

## Files to Create/Modify

### New Files

| File                      | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `src/lib/profiles.ts`     | Profile CRUD operations, validation, defaults |
| `src/commands/profile.ts` | Profile management subcommands                |

### Modified Files

| File                            | Changes                                              |
| ------------------------------- | ---------------------------------------------------- |
| `src/types.ts`                  | Profile types, ProviderType, updated AppConfig       |
| `src/lib/config.ts`             | Migration logic, profile storage                     |
| `src/commands/launch.ts`        | Profile-based launch instead of hardcoded            |
| `src/commands/setup.ts`         | Profile-aware setup flow                             |
| `src/lib/validate.ts`           | Profile validation, provider-specific key validation |
| `src/commands/vscode-config.ts` | Profile selection for VSCode                         |
| `src/index.ts`                  | New profile subcommand, updated launch argument      |

## Migration Strategy

**For existing users:**

1. First run detects old config format (missing `profiles` field)
2. Automatic migration:
   - `claudeAuthMode: 'subscription'` → Profile `claude`
   - `claudeAuthMode: 'api-key'` + `anthropicApiKey` → Profile `claude-api`
   - `kimiApiKey` → Profile `kimi`
3. Preserve old config as `config.json.backup`
4. `setupComplete: true` remains true

**Backward compatibility:**

- `flip-cc launch claude` still works (looks up profile by ID)
- `flip-cc launch kimi` still works
- Old configs auto-migrate on first run

## Verification Steps

1. **Migration test:**

   ```bash
   # Create old-format config
   echo '{"claudeAuthMode":"api-key","anthropicApiKey":"test","setupComplete":true}' > ~/.config/flip-cc/config.json
   bun run dev profile list  # Should show migrated profile
   ```

2. **Profile CRUD:**

   ```bash
   bun run dev profile add        # Create custom profile
   bun run dev profile list       # Verify it appears
   bun run dev profile edit <id>  # Modify it
   bun run dev profile remove <id> # Delete it
   ```

3. **Launch with profiles:**

   ```bash
   bun run dev launch claude      # Default profile
   bun run dev launch kimi        # Kimi profile
   bun run dev launch nonexistent # Error: profile not found
   ```

4. **Setup flow:**

   ```bash
   bun run dev setup              # Should migrate + offer profile management
   ```

5. **OpenRouter (Phase 6):**
   ```bash
   bun run dev profile add        # Select OpenRouter, pick model
   bun run dev launch <id>        # Should use OpenRouter
   ```

## Phase Split Recommendation

**Phase 1: Profile Infrastructure (MVP)**

- Profile types and storage
- Migration from existing config
- Refactor launch to use profiles
- `profile list`, `profile add`, `profile remove` commands
- Keep Kimi and Anthropic as only providers initially

**Phase 2: OpenRouter Support**

- Add 'openrouter' ProviderType
- OpenRouter model selection in profile add/edit
- Done - infrastructure already supports it

This way, OpenRouter comes "for free" once profiles work.
