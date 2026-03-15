# flip-cc Code Review

> Reviewed: 2026-03-16
> Scope: All source files under `src/` (~1,200 LOC across 12 files)
> Branch: `feature-openai-compatible`
> Status: **All issues resolved** ✅

---

## 1. Security Issues

### ~~[CRITICAL] Proxy error logs may expose API keys in error messages~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

All `console.error` calls now log only `err instanceof Error ? err.message : String(err)` — the raw error object is never serialised to the console.

---

### ~~[HIGH] Temp home directory is world-readable~~ ✅ Fixed

**File:** `src/commands/launch.ts`

`chmodSync(tempHome, 0o700)` is applied immediately after `mkdtempSync` inside `createTempHome()`, regardless of system umask.

---

### ~~[MEDIUM] Hardcoded dummy API key has a predictable, fingerprintable pattern~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

The dummy key is now generated at runtime: `sk-ant-proxy-${randomBytes(64).toString('base64url')}`. It satisfies the `sk-ant-` prefix check and length requirement, and is unique per process invocation.

---

### ~~[MEDIUM] Proxy accepts any unauthenticated localhost request~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

`startProxy()` generates a random per-session bearer token and passes it to Claude Code via `ANTHROPIC_API_KEY`. `makeHandler` verifies `Authorization: Bearer <token>` on every request, rejecting mismatches with 401.

---

## 2. Bugs

### ~~[HIGH] `mkdtempSync` has no error handling~~ ✅ Fixed

**File:** `src/commands/launch.ts`

Wrapped in try-catch inside `createTempHome()`. On failure, emits `chalk.red('Error: Could not create temp directory:')` + `err.message` then exits cleanly.

---

### ~~[HIGH] `removeFlipCcKeys()` brace counter doesn't handle `]`/`}` inside string values~~ ✅ Fixed

**File:** `src/commands/vscode-config.ts`

Replaced the character-by-character brace counter with a proper JSON `parse → delete keys → stringify` approach. Eliminates the fragile trailing-comma cleanup regex too.

---

### ~~[MEDIUM] PATH separator hardcoded as `:`~~ ✅ Fixed

**File:** `src/commands/launch.ts`

Uses `delimiter` from the `path` module: `` `${localBinPath}${delimiter}${process.env.PATH || ''}` ``.

---

### ~~[MEDIUM] Circular dependency workaround via runtime `require()`~~ ✅ Fixed

**File:** `src/commands/profile.ts`

Circular import resolved at the module level. The runtime `require('../lib/config.js')` workaround has been removed.

---

### ~~[MEDIUM] Streaming body read has no independent timeout~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

`convertStreamAsync` now accepts an `AbortSignal` and each `reader.read()` is wrapped in `Promise.race([readPromise, timeoutPromise])` so a stalled upstream can't hold the session open indefinitely.

---

### ~~[LOW] `findFreePort()` has a TOCTOU race condition~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

`findFreePort()` removed entirely. `startProxy()` passes `port: 0` directly to `Bun.serve()` and reads `server.port` after the server binds. No window between port discovery and bind.

---

### ~~[LOW] Silent catch-all hides `.claude.json` config patching failures~~ ✅ Fixed

**File:** `src/commands/launch.ts`

The empty `catch {}` block now emits two `chalk.yellow('Warning:')` lines explaining that patching failed and that the "Detected a custom API key" dialog may appear.

---

## 3. Refactoring Opportunities

### ~~Extract `createIsolatedHomeForApiKey()` into focused sub-functions~~ ✅ Done

**File:** `src/commands/launch.ts`

Decomposed into `createTempHome()`, `setupLocalBinSymlink()`, `setupClaudeJsonConfig()`, and `setupClaudeDir()`. `createIsolatedHomeForApiKey()` is now a thin orchestrator.

---

### ~~Deduplicate `maskApiKey()`~~ ✅ Done

**File:** `src/lib/utils.ts`

Single canonical implementation exported from `utils.ts` (shows first 4 + last 4 chars). Both `profile.ts` and `vscode-config.ts` import from there.

---

### ~~Replace brace-counting JSON manipulation with proper parse/stringify~~ ✅ Done

See `removeFlipCcKeys()` fix above.

---

### ~~`setup.ts` provider configuration can be split into clearer modules~~ ✅ Done

**Directory:** `src/commands/setup/`

Split into `index.ts` (entry point) + `anthropic.ts`, `kimi.ts`, `openrouter.ts`, `openai-compatible.ts`. Each provider configuration lives in its own file.

---

### ~~`getProviderDisplay()` is also duplicated~~ ✅ Done

**File:** `src/lib/utils.ts`

Canonical implementation alongside `maskApiKey()`. Both `profile.ts` and `vscode-config.ts` import from `utils.ts`.

---

## 4. Code Quality / Minor Issues

### ~~Inconsistent error-exit strategy across command files~~ ✅ Addressed

`process.exit(1)` is now used consistently only at top-level command handler boundaries. Internal functions throw or return errors upward rather than exiting inline.

---

### ~~`extraEnv` values in profiles are not length- or injection-checked~~ ✅ Fixed

**File:** `src/commands/profile.ts`

Inline `validate` callback in the `input()` prompt strips null bytes and rejects values exceeding 4096 bytes (`Buffer.byteLength` for correct multi-byte UTF-8 counting). The assignment also sanitises: `envValue.replace(/\0/g, '')`.

---

### ~~No tests — `proxy-convert.ts` is fully unit-testable but untested~~ ✅ Fixed

**File:** `src/lib/proxy-convert.test.ts`

52 tests / 126 assertions using Bun's built-in test runner. Covers all five exported functions including edge cases: tool-use interleaving with text deltas, `[DONE]` sentinel, malformed JSON arguments, null content, and stream state transitions.

---

### ~~Magic constant `PROXY_DUMMY_API_KEY` lacks a comment explaining its format requirements~~ ✅ Fixed

**File:** `src/lib/proxy.ts`

Comment added: `// Must satisfy claude-code's sk-ant- prefix check and minimum length (~88 chars).` (Moot now that the key is generated randomly, but the constraint comment is retained for future maintainers.)

---

### ~~`which claude` command is not available on Windows~~ ✅ Fixed

**File:** `src/commands/launch.ts`

Uses `process.platform === 'win32' ? 'where claude' : 'which claude'` with a 5 000 ms timeout.

---
