# VSCode Extension Integration

flip-cc can configure the official Claude Code VSCode extension to use any profile you have set up. The configuration persists across VSCode sessions without requiring flip-cc to be running.

---

## How it works

flip-cc writes directly to VSCode's `settings.json` file. It injects the environment variables that the Claude Code extension reads at startup:

```json
{
  "claudeCode.environmentVariables": [
    { "name": "ANTHROPIC_API_KEY", "value": "sk-..." },
    { "name": "ANTHROPIC_BASE_URL", "value": "https://api.kimi.com/coding/" },
    { "name": "ANTHROPIC_MODEL", "value": "kimi-for-coding" },
    { "name": "ENABLE_TOOL_SEARCH", "value": "false" }
  ],
  "claudeCode.disableLoginPrompt": true
}
```

For Anthropic subscription profiles, no API key is written — instead the extension sets `CLAUDE_CODE_MAX_THINKING_TOKENS=0` to prevent extended-thinking errors that can occur in subscription mode.

`claudeCode.disableLoginPrompt: true` is set for all API key profiles to suppress the login dialog.

### Limitation: openai-compatible profiles

The `openai-compatible` provider requires the flip-cc local proxy, which only runs during a CLI `flip-cc launch` session. VSCode cannot start this proxy on its own, so `flip-cc vscode-config` refuses to configure `openai-compatible` profiles and displays an explanatory error. Use `flip-cc launch <profile>` for these profiles instead.

---

## Settings.json locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |
| Windows | `%APPDATA%\Code\User\settings.json` |

The file is created automatically if it does not exist.

---

## Running `flip-cc vscode-config`

```bash
flip-cc vscode-config
```

1. If no profiles are configured, the command exits with an error and prompts you to run `flip-cc setup`.
2. If `claudeCode.environmentVariables` is already present in `settings.json`, you are asked to confirm before overwriting.
3. An interactive list of your profiles is shown. The current default profile is pre-selected.
4. After you select a profile, flip-cc validates that it is ready (API key present if required), backs up your settings, writes the new configuration, and prints a summary.

Example output:

```
VSCode Extension Integration Setup

? Which profile would you like to use in VSCode?
  > Claude (Subscription) [default]
    Moonshot Kimi 2.5
    OpenRouter Claude Sonnet

Configuration:
  Settings file: /home/user/.config/Code/User/settings.json
  Profile: Moonshot Kimi 2.5 (kimi)
  Provider: Kimi

Environment variables:
  ANTHROPIC_API_KEY: sk-••••...••••
  ANTHROPIC_BASE_URL: https://api.kimi.com/coding/
  ANTHROPIC_MODEL: kimi-for-coding
  ENABLE_TOOL_SEARCH: false
```

---

## Removing the configuration

```bash
flip-cc vscode-config --remove
```

This removes `claudeCode.environmentVariables` and `claudeCode.disableLoginPrompt` from `settings.json`. All other VSCode settings are left untouched. A backup of the file before removal is written first.

After removal, restart VSCode to revert to its default behaviour (typically prompting for a claude.ai login).

---

## The backup mechanism

Before any write to `settings.json`, flip-cc saves the current content to:

```
<settings-dir>/settings.json.flip-cc.bak
```

This backup has restricted permissions (`0o600` — owner read/write only). It is overwritten each time `flip-cc vscode-config` runs, so it always reflects the state immediately before the most recent change.

To restore manually:

```bash
cp ~/.config/Code/User/settings.json.flip-cc.bak \
   ~/.config/Code/User/settings.json
```

If `settings.json` is not valid JSON when flip-cc reads it, the write is skipped entirely with a warning to avoid corrupting the file.

---

## Switching profiles in VSCode

Run `flip-cc vscode-config` again and select a different profile. The existing configuration is replaced with the new profile's environment variables.

---

## Restarting VSCode properly

VSCode reads environment variables from `settings.json` only at startup. A window reload (`Ctrl+Shift+P` → `Developer: Reload Window`) is not sufficient — the extension process must restart.

The correct procedure is:

1. `Ctrl+Shift+P` → type `Quit` → select **File: Quit**
2. Relaunch VSCode from your application launcher or terminal.

flip-cc reminds you of this step after every successful `vscode-config` run.

---

## Security note

API keys written to `settings.json` are stored as plain text. Any process running as your user, or any VSCode extension with filesystem access, can read them. This is the same risk as storing keys in shell profile files (`.bashrc`, `.zshrc`).

If this is a concern, use `flip-cc launch` from the terminal instead, which stores keys in the OS-specific config directory managed by the `conf` library and only passes them as environment variables to the short-lived `claude` child process.
