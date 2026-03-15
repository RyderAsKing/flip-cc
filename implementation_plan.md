# flip-cc Implementation Plan

## Context

The README defines `flip-cc` — a CLI launcher that wraps Claude Code and allows seamless switching between Anthropic (subscription or API key) and Moonshot Kimi 2.5 (API key + env injection). The project is greenfield: only `README.md` exists. This plan covers building the full implementation.

---

## Project Structure

```
flip-cc/
├── src/
│   ├── index.ts            # CLI entry point (Commander root program)
│   ├── commands/
│   │   ├── setup.ts        # `flip-cc setup` handler
│   │   └── launch.ts       # `flip-cc launch <target>` handler
│   ├── lib/
│   │   ├── config.ts       # Conf wrapper — typed schema, read/write helpers
│   │   ├── spawn.ts        # child_process.spawn with stdio inheritance + env overrides
│   │   └── validate.ts     # Pure input validation helpers
│   └── types.ts            # Shared TypeScript types (AppConfig, AuthMode, etc.)
├── package.json
├── tsconfig.json
├── build.ts                # Bun multi-platform compile script
└── .gitignore
```

---

## Key Configuration Files

### `package.json`
```json
{
  "name": "flip-cc",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun run build.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.3.0",
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "conf": "^15.1.0"
  },
  "devDependencies": {
    "@commander-js/extra-typings": "^14.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.9.3"
  }
}
```
> `"type": "module"` is required — `conf` and `@inquirer/prompts` are ESM-only.

### `tsconfig.json`
- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` (required for ESM + `.js` import extensions)
- `"target": "ES2022"`, `strict: true`, `noUncheckedIndexedAccess: true`
- `tsc --noEmit` for type-checking only; Bun compiles directly from TypeScript source.

---

## Source Files

### `src/types.ts`
```typescript
export type AuthMode = 'subscription' | 'api-key';
export type LaunchTarget = 'claude' | 'kimi';

export interface AppConfig {
  claudeAuthMode: AuthMode;
  anthropicApiKey?: string;
  kimiApiKey?: string;
  setupComplete: boolean;
}
```

### `src/lib/config.ts`
- Wraps `Conf<AppConfig>` with a JSON Schema matching `AppConfig`
- Config path handled by `conf` automatically:
  - macOS: `~/Library/Preferences/flip-cc/`
  - Linux: `~/.config/flip-cc/`
  - Windows: `%APPDATA%\flip-cc\`
- Exports: `getConfig()`, `setConfig(patch)`, `isSetupComplete()`, `clearConfig()`
- Security: file permissions protect keys (same model as AWS CLI, npm). No `keytar` — native `.node` bindings are incompatible with Bun standalone binary compilation.

### `src/lib/spawn.ts`
- Wraps `child_process.spawn` with `stdio: 'inherit'` (full interactive terminal passthrough)
- Accepts `envOverrides?: Record<string, string>` — merges into `{ ...process.env, ...overrides }`, never mutates `process.env` globally
- Returns `Promise<void>` — resolves on exit code 0, rejects otherwise (propagates exit code)
- Forwards `SIGINT`/`SIGTERM` to child so Ctrl-C works correctly
- Windows: uses `shell: true` to resolve `.cmd`/`.exe` entries on PATH

### `src/lib/validate.ts`
- `validateApiKey(key, type): string | true` — format check only (Anthropic: `sk-ant-` prefix; Kimi: non-empty, min-length). Returns error string or `true` for Inquirer's `validate` option.
- `validateSetupComplete(config, target): string | true` — checks required config is present before spawning.

### `src/commands/setup.ts`
Inquirer prompt flow (sequential `await` calls):
1. If `isSetupComplete()`, `confirm` to redo setup (exit if no)
2. `select` auth mode: `'subscription'` | `'api-key'`
3. If `'api-key'`: `password` prompt for Anthropic key (validated inline)
4. `confirm` to also configure Kimi; if yes: `password` prompt for Kimi key
5. `setConfig(...)` and print chalk success summary

### `src/commands/launch.ts`
Three branches after validating config completeness:
- **`launch kimi`**: injects `ENABLE_TOOL_SEARCH=false`, `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`, `ANTHROPIC_API_KEY=<kimi-key>`
- **`launch claude`** (no `--key`): clean spawn, no env overrides — subscription auth
- **`launch claude --key`**: injects `ANTHROPIC_API_KEY=<anthropic-key>` only

### `src/index.ts`
Commander root program — thin wiring only, no business logic:
```typescript
#!/usr/bin/env node
program.command('setup').action(async () => setupCommand());
program.command('launch')
  .argument('<target>')
  .option('--key', 'Use saved Anthropic API key', false)
  .action(async (target, options) => launchCommand(target, options));
program.parseAsync(process.argv); // required for async action handlers
```

### `build.ts`
Bun multi-platform compile script producing standalone binaries:
- `bun-linux-x64` → `dist/flip-cc-linux-x64`
- `bun-darwin-x64` → `dist/flip-cc-macos-x64`
- `bun-darwin-arm64` → `dist/flip-cc-macos-arm64`
- `bun-windows-x64` → `dist/flip-cc-windows-x64.exe`

Uses `bun build src/index.ts --compile --target=<target> --outfile=<outfile>`. Bundles runtime + all deps — end users need nothing installed.

---

## Implementation Order

1. **Scaffolding**: `package.json`, `tsconfig.json`, `.gitignore` → `bun install`
2. **`src/types.ts`**: All shared types
3. **`src/lib/validate.ts`**: Pure validators (no deps)
4. **`src/lib/config.ts`**: Conf wrapper + JSON Schema; verify config file location
5. **`src/lib/spawn.ts`**: `launchClaude()` with `stdio: 'inherit'`; smoke test with `echo` first
6. **`src/commands/setup.ts`**: Inquirer prompt flow; test interactively
7. **`src/commands/launch.ts`**: Three-branch launch logic; test all three modes
8. **`src/index.ts`**: Commander wiring; verify `--help` output
9. **`build.ts`**: Multi-platform compile; test binary in clean shell
10. **Polish**: chalk colors on errors/success, final help text review

---

## Verification

- `bun run dev setup` → interactive prompts, keys written to OS config dir
- `bun run dev launch kimi` → verify `ANTHROPIC_BASE_URL` is set inside the session
- `bun run dev launch claude` → clean spawn, no env overrides
- `bun run dev launch claude --key` → `ANTHROPIC_API_KEY` injected
- `bun run build` → four platform binaries in `dist/`
- Binary smoke test: run `dist/flip-cc --help` without Node/Bun on PATH
- Exit code propagation: verify `flip-cc launch` mirrors the child's exit code
