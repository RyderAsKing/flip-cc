import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getConfig } from '../lib/config.js';
import { validateSetupComplete } from '../lib/validate.js';
import type { LaunchTarget } from '../types.js';

/**
 * Get the VSCode user settings.json path (platform-aware)
 */
function getVSCodeSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  } else if (process.platform === 'win32') {
    return join(process.env.APPDATA || home, 'Code', 'User', 'settings.json');
  }
  return join(home, '.config', 'Code', 'User', 'settings.json');
}

type EnvVar = { name: string; value: string };

function buildEnvVars(mode: string, config: ReturnType<typeof getConfig>): EnvVar[] {
  if (mode === 'kimi') {
    return [
      { name: 'ANTHROPIC_BASE_URL', value: 'https://api.kimi.com/coding/' },
      { name: 'ANTHROPIC_API_KEY', value: config.kimiApiKey! },
      { name: 'ANTHROPIC_MODEL', value: 'kimi-for-coding' },
      { name: 'ENABLE_TOOL_SEARCH', value: 'false' },
    ];
  }
  if (mode === 'claude-key') {
    return [{ name: 'ANTHROPIC_API_KEY', value: config.anthropicApiKey! }];
  }
  // Subscription mode: disable extended thinking to prevent "Invalid signature in thinking block" errors
  return [{ name: 'CLAUDE_CODE_MAX_THINKING_TOKENS', value: '0' }];
}

/**
 * Update settings.json by doing targeted insertions near the closing brace.
 * Always backs up the file first. Never removes or rewrites existing content.
 */
function updateSettingsFile(settingsPath: string, envVars: EnvVar[], disableLogin = true): void {
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content: string;
  if (existsSync(settingsPath)) {
    // Back up before any modification
    copyFileSync(settingsPath, settingsPath + '.flip-cc.bak');
    content = readFileSync(settingsPath, 'utf-8');
  } else {
    content = '{}\n';
  }

  // Build replacement block
  if (envVars.length === 0) {
    // No overrides: strip any previously managed keys
    content = removeFlipCcKeys(content);
  } else {
    // Strip existing managed keys first, then re-insert cleanly
    content = removeFlipCcKeys(content);

    const envVarsJson = JSON.stringify(envVars, null, 2)
      .split('\n')
      .map((l, i) => (i === 0 ? l : '  ' + l))
      .join('\n');

    const loginLine = disableLogin ? `\n  "claudeCode.disableLoginPrompt": true,` : '';
    const block = `  "claudeCode.environmentVariables": ${envVarsJson},${loginLine}\n`;

    // Insert before the final closing brace
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace === -1) {
      content = `{\n${block}}\n`;
    } else {
      const before = content.slice(0, lastBrace);
      // Ensure there's a comma on the last real property if needed
      const trimmed = before.trimEnd();
      const needsComma = trimmed.length > 1 && !trimmed.endsWith('{') && !trimmed.endsWith(',');
      content = trimmed + (needsComma ? ',' : '') + '\n' + block + '}\n';
    }
  }

  writeFileSync(settingsPath, content, 'utf-8');
}

/**
 * Remove claudeCode.environmentVariables and claudeCode.disableLoginPrompt from content.
 * Uses a line-based approach: drop lines belonging to those keys.
 */
function removeFlipCcKeys(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skip = 0; // depth counter for skipping array/object blocks

  for (const line of lines) {
    if (line === undefined) continue;

    if (skip > 0) {
      for (const ch of line) {
        if (ch === '[' || ch === '{') skip++;
        if (ch === ']' || ch === '}') skip--;
      }
      continue;
    }

    const isEnvVars = /"claudeCode\.environmentVariables"\s*:/.test(line);
    const isDisable = /"claudeCode\.disableLoginPrompt"\s*:/.test(line);

    if (isEnvVars) {
      for (const ch of line) {
        if (ch === '[') skip++;
        if (ch === ']') skip--;
      }
      continue;
    }

    if (isDisable) continue;

    result.push(line);
  }

  // Clean up any double-commas or trailing commas before } left by removal
  let out = result.join('\n');
  out = out.replace(/,(\s*,)+/g, ',');
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

/**
 * Remove claudeCode settings from settings.json
 */
function removeSettings(settingsPath: string): void {
  if (!existsSync(settingsPath)) return;
  copyFileSync(settingsPath, settingsPath + '.flip-cc.bak');
  const content = removeFlipCcKeys(readFileSync(settingsPath, 'utf-8'));
  writeFileSync(settingsPath, content.trimEnd() + '\n', 'utf-8');
}

/**
 * Remove any legacy PATH-based claude shim left from a previous flip-cc version.
 */
function removeLegacyShim(): void {
  const shimPath = join(process.env.HOME || '', '.local', 'bin', 'claude');
  if (!existsSync(shimPath)) return;
  try {
    const content = readFileSync(shimPath, 'utf-8');
    if (content.includes('flip-cc') || content.includes('Generated by flip-cc')) {
      rmSync(shimPath);
      console.log(chalk.gray('  (removed legacy flip-cc shim from ~/.local/bin/claude)'));
    }
  } catch {
    // ignore — not our file
  }
}

export interface VscodeShimOptions {
  remove?: boolean;
}

export async function vscodeShimCommand(options: VscodeShimOptions): Promise<void> {
  const settingsPath = getVSCodeSettingsPath();

  // ── Remove ──────────────────────────────────────────────────────────────────
  if (options.remove) {
    if (!existsSync(settingsPath)) {
      console.log(chalk.yellow('VSCode settings file not found. Nothing to remove.'));
      return;
    }
    removeSettings(settingsPath);
    console.log(chalk.green('✓ Removed flip-cc VSCode configuration from:'), settingsPath);
    console.log(chalk.gray('  Restart VSCode for the change to take effect.'));
    return;
  }

  // ── Validate setup ──────────────────────────────────────────────────────────
  const config = getConfig();
  const setupValidation = validateSetupComplete(config, 'kimi', false);
  if (setupValidation !== true) {
    console.error(chalk.red('Error: ' + setupValidation));
    console.log(chalk.yellow('Please run ') + chalk.cyan('flip-cc setup') + chalk.yellow(' first.'));
    process.exit(1);
  }

  // ── Already configured? ─────────────────────────────────────────────────────
  const currentContent = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf-8') : '';
  if (currentContent.includes('claudeCode.environmentVariables')) {
    const reconfigure = await confirm({
      message: 'VSCode is already configured. Reconfigure?',
      default: false,
    });
    if (!reconfigure) {
      console.log(chalk.yellow('Setup cancelled.'));
      return;
    }
  }

  console.log();
  console.log(chalk.blue('📝 VSCode Extension Integration Setup\n'));

  // ── Mode selection ──────────────────────────────────────────────────────────
  const vscodeMode = await select<LaunchTarget | 'claude-key' | 'claude-subscription'>({
    message: 'Which backend would you like to use in VSCode?',
    choices: [
      {
        name: 'Moonshot Kimi 2.5',
        value: 'kimi',
        description: config.kimiApiKey
          ? 'Use your configured Kimi API key'
          : chalk.yellow('Kimi API key not configured yet'),
      },
      {
        name: 'Claude (API Key)',
        value: 'claude-key',
        description: config.anthropicApiKey
          ? 'Use your configured Anthropic API key'
          : chalk.yellow('Anthropic API key not configured yet'),
      },
      {
        name: 'Claude (Subscription)',
        value: 'claude-subscription',
        description: 'Use your claude.ai Pro/Max subscription',
      },
    ],
    default: 'kimi',
  });

  if (vscodeMode === 'kimi' && !config.kimiApiKey) {
    console.error(chalk.red('\nError: Kimi API key not configured.'));
    console.log(chalk.yellow('Run ') + chalk.cyan('flip-cc setup') + chalk.yellow(' to add your Kimi API key first.'));
    process.exit(1);
  }
  if (vscodeMode === 'claude-key' && !config.anthropicApiKey) {
    console.error(chalk.red('\nError: Anthropic API key not configured.'));
    console.log(chalk.yellow('Run ') + chalk.cyan('flip-cc setup') + chalk.yellow(' to add your Anthropic API key first.'));
    process.exit(1);
  }

  // ── Update settings.json ────────────────────────────────────────────────────
  const envVars = buildEnvVars(vscodeMode, config);

  try {
    updateSettingsFile(settingsPath, envVars, vscodeMode !== 'claude-subscription');
  } catch (error) {
    console.error(chalk.red('\nError updating VSCode settings:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Clean up any legacy PATH shim silently
  removeLegacyShim();

  // ── Success ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.green('✓ VSCode settings updated successfully!'));
  console.log();
  console.log(chalk.bold('Configuration:'));
  console.log(`  Settings file: ${chalk.cyan(settingsPath)}`);
  console.log(`  Backend: ${chalk.cyan(vscodeMode)}`);
  if (envVars.length > 0) {
    for (const v of envVars) {
      const display = v.name === 'ANTHROPIC_API_KEY' ? v.value.slice(0, 12) + '...' : v.value;
      console.log(`  ${v.name}: ${chalk.gray(display)}`);
    }
  }
  console.log();

  console.log(chalk.bold('Next steps:'));
  console.log('  1. Fully restart VSCode (not just reload window):');
  console.log(chalk.cyan('     Ctrl+Shift+P → Quit, then relaunch'));
  console.log();
  console.log('  2. Open the Claude Code panel and verify the connection');
  console.log();
  console.log(chalk.gray('Note: A full restart is required for environment variable changes to take effect.\n'));

  console.log(chalk.bold('Switching modes later:'));
  console.log('  Run this command again to change the backend.\n');

  console.log(chalk.bold('To remove the configuration:'));
  console.log(`  ${chalk.cyan('flip-cc vscode-config --remove')}\n`);
}
