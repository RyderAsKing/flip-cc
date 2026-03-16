# Code Review: flip-cc

A comprehensive review of the flip-cc codebase with suggestions for improving code quality, structure, and maintainability.

---

## 1. Code Duplication

### Setup Provider Files Are Nearly Identical

`src/commands/setup/anthropic.ts`, `kimi.ts`, `openrouter.ts`, and `openai-compatible.ts` all follow the same pattern: prompt for profile ID, prompt for API key, validate, save. These could be consolidated into a single factory function.

**Suggestion:** Create a generic `createProviderSetup(options)` function that accepts provider-specific config (prompts, validation rules, default base URL) and returns the setup handler.

```typescript
// src/commands/setup/provider-factory.ts
interface ProviderSetupOptions {
  provider: string;
  defaultBaseUrl?: string;
  requiresModel?: boolean;
  requiresBaseUrl?: boolean;
  apiKeyPrompt?: string;
  validateKey?: (key: string) => boolean;
}

export function createProviderSetup(options: ProviderSetupOptions) {
  return async function setup(config: AppConfig): Promise<SetupResult> {
    // shared logic here
  };
}
```

### Repeated `process.env.HOME` Fallback Chain

The pattern `process.env.HOME || process.env.USERPROFILE || tmpdir()` appears in 3 places (`launch.ts:173`, `launch.ts:223`, `vscode-config.ts:14`). Extract to a utility:

```typescript
// src/lib/utils.ts
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || tmpdir();
}
```

### Profile Retrieval + Existence Check

Getting a profile by ID then checking if it exists is repeated 4+ times in `profile.ts`. Extract to a helper:

```typescript
function getProfileOrExit(profileId: string): Profile {
  const profile = getProfile(profileId);
  if (!profile) {
    console.log(chalk.red(`Profile "${profileId}" not found.`));
    process.exit(1);
  }
  return profile;
}
```

---

## 2. Type Safety

### Unsafe Type Assertion in `profiles.ts:67`

```typescript
profiles[index] = { ...profiles[index], ...updates } as Profile;
```

The `as Profile` assertion bypasses TypeScript's structural checks. If `updates` contains only partial fields, the merged object might not satisfy all required `Profile` fields.

**Fix:** Use `Partial<Profile>` for updates and validate the merged result, or ensure the spread always produces a valid `Profile` via a validation function.

### `unknown` Types in `proxy-convert.ts`

Several places use `unknown` or loose object types:
- Line 128: `[key: string]: unknown` in `OpenAIRequest`
- Lines 235-236: `unknown` type for SSE event data
- Lines 465-469: Silent JSON parse failure falls back to empty object

**Fix:** Define stricter interfaces for OpenAI request/response shapes. Use a JSON parse wrapper that returns a discriminated union (`{ ok: true, data: T } | { ok: false, error: Error }`).

### Type Assertions Without Guards

- `spawn.ts:26` — copies `process.env` with type assertion
- `setup/index.ts:123` — type assertion on `result.config`
- `profile.ts:544` — type assertion on block without runtime guard

**Fix:** Add runtime type guards (narrowing functions) before assertions, or use `satisfies` where appropriate.

---

## 3. Error Handling

### Silent Failures

Several catch blocks silently swallow errors with comments like `// Ignore`:
- Credential file parsing in `launch.ts` — if `.credentials.json` is malformed, it silently continues
- VSCode settings parsing in `vscode-config.ts:136-139` — invalid JSON silently refuses to write without warning the user

**Fix:** At minimum, log a warning so users can diagnose issues. Consider a `--verbose` / `--debug` flag for detailed output.

### Generic Error Messages

`proxy.ts:196-207` reports "Request processing failed" without upstream context. When the upstream API returns a specific error, that context is lost.

**Fix:** Include the upstream status code and error body (truncated) in error responses.

### Missing Validation in Profile Fallback

`launch.ts:343-348` — when no profile is specified, falls back to the default profile without validating it exists or is ready. If the default profile was deleted, the error message will be confusing.

---

## 4. Test Coverage

### What's Covered

`proxy-convert.test.ts` is excellent — 862 lines covering 63+ test cases for Anthropic-to-OpenAI and OpenAI-to-Anthropic conversion, streaming, tool use, and token counting.

### What's Missing

| Module | Risk | What to Test |
|--------|------|--------------|
| `launch.ts` | **High** | Isolated home dir creation, credential filtering, env var building, API key fingerprinting |
| `config.ts` | **Medium** | Legacy migration, profile persistence, config backup/restore |
| `validate.ts` | **Medium** | API key format validation edge cases, profile readiness checks |
| `spawn.ts` | **Low** | Signal forwarding, environment overrides, Windows shell behavior |
| `profile.ts` | **Medium** | CRUD operations, default profile logic, env var management |
| Integration | **High** | Full workflow: add profile → set default → launch |

**Suggestion:** Prioritize `launch.ts` tests since it handles file system operations and security-sensitive credential filtering.

---

## 5. Architecture Suggestions

### Add a Debug/Logging Layer

Currently there's no way to troubleshoot failures. A simple debug logger would help:

```typescript
// src/lib/logger.ts
const DEBUG = process.env.FLIP_CC_DEBUG === '1';

export function debug(context: string, ...args: unknown[]) {
  if (DEBUG) console.error(chalk.gray(`[debug:${context}]`), ...args);
}
```

Use throughout the codebase: `debug('launch', 'Creating isolated home at', tempHome)`.

### Centralize Provider Definitions

Provider-specific data (name, default base URL, color, key prefix pattern) is scattered across setup files, `profiles.ts`, `utils.ts`, and `validate.ts`. A single `providers.ts` registry would be cleaner:

```typescript
// src/lib/providers.ts
export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    color: chalk.hex('#d97706'),
    defaultBaseUrl: undefined,
    keyPrefix: 'sk-ant-',
    requiresModel: false,
  },
  kimi: {
    name: 'Kimi',
    color: chalk.hex('#6366f1'),
    defaultBaseUrl: 'https://api.kimi.com/coding/',
    keyPrefix: undefined,
    requiresModel: false,
  },
  // ...
} as const;
```

### Separate File System Operations from Business Logic in `launch.ts`

`launch.ts` (445 lines) mixes file system operations (copying directories, writing credentials) with business logic (deciding what to copy, building env vars). Splitting these would improve testability:

- `src/lib/isolated-home.ts` — pure file system operations (copy dir, filter credentials, create symlink)
- `src/commands/launch.ts` — orchestration and profile resolution

This makes it possible to unit test the business logic with mocked FS operations.

---

## 6. Security

### Good Practices Already in Place

- `BLOCKED_ENV_KEYS` prevents `LD_PRELOAD`/`DYLD_*` injection
- API key fingerprinting stores only last 20 chars
- Temp directory permissions set to `0o700`
- Settings backup uses `0o600`
- URL validation with `new URL()` constructor

### Improvements

1. **Environment variable values are not sanitized** — `profile.ts:269` checks key names with regex but doesn't validate values for control characters or null bytes. Add: `if (/[\x00-\x08\x0e-\x1f]/.test(value))` reject.

2. **No prompt timeout** — interactive prompts (`@inquirer/prompts`) will wait indefinitely. For scripted/CI environments, consider a timeout or `--non-interactive` flag.

3. **API keys stored in plaintext** — `conf` uses OS config directories but doesn't encrypt values. Consider integrating with the system keychain for sensitive data, or at minimum document this trade-off.

---

## 7. Build System

### Missing Windows Target

`build.ts` defines targets for Linux x64, macOS x64, and macOS arm64, but the Windows x64 target appears to be missing from the targets array despite being mentioned in `CLAUDE.md`.

### No Version Injection

The version is hardcoded in `package.json` and displayed via Commander's `.version()`. The build output filenames don't include the version. Consider injecting the version into the binary name or a `--version` output that includes the git commit hash.

### Build Error Handling

The build script checks `!hasError` before copying the platform binary, but `hasError` could be stale if an earlier target failed but the current platform succeeded. Check individual build results instead.

---

## 8. Minor Code Quality Items

| Issue | Location | Suggestion |
|-------|----------|------------|
| `require('fs')` instead of ES import | `config.ts:76` | Use `import { existsSync } from 'fs'` for consistency |
| Hardcoded `/tmp` fallback | `vscode-config.ts:14` | Use `os.tmpdir()` (already used elsewhere) |
| Redundant `\|\| undefined` | `launch.ts:264, 295` | `profile.apiKey` is already `string \| undefined` |
| Inconsistent error exit patterns | Various | Some use `process.exit(1)`, some throw, some return — standardize |
| No `.editorconfig` or formatting config | Root | Add prettier/biome config to enforce consistent style |

---

## 9. Summary of Priorities

### High Priority
1. Add unit tests for `launch.ts` — most critical untested path
2. Fix unsafe type assertions in `profiles.ts` and `proxy-convert.ts`
3. Add the missing Windows build target to `build.ts`
4. Replace silent error swallowing with warnings

### Medium Priority
5. Extract common setup provider logic to reduce duplication
6. Add a debug logging layer (`FLIP_CC_DEBUG=1`)
7. Centralize provider definitions into a single registry
8. Separate file system operations from business logic in `launch.ts`
9. Add integration tests for profile workflows

### Low Priority
10. Standardize error exit patterns across commands
11. Add formatter config (prettier/biome)
12. Consider system keychain integration for API key storage
13. Add `--non-interactive` flag for CI environments
