import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { maskApiKey, getProviderDisplay, getHomeDir } from '../lib/utils.js';
import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getProfiles, getProfile, getDefaultProfileId } from '../lib/profiles.js';
import { validateProfileReady } from '../lib/validate.js';
import type { Profile } from '../types.js';

/**
 * Get the VSCode user settings.json path (platform-aware)
 */
function getVSCodeSettingsPath(): string {
  const home = getHomeDir();
  let settingsPath: string;
  let expectedBase: string;

  if (process.platform === 'darwin') {
    expectedBase = resolve(home);
    settingsPath = resolve(join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'));
  } else if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || home;
    expectedBase = resolve(appdata);
    settingsPath = resolve(join(appdata, 'Code', 'User', 'settings.json'));
  } else {
    expectedBase = resolve(home);
    settingsPath = resolve(join(home, '.config', 'Code', 'User', 'settings.json'));
  }

  const rel = relative(expectedBase, settingsPath);
  if (isAbsolute(rel) || rel.startsWith('..')) {
    throw new Error(
      `VSCode settings path "${settingsPath}" is outside the expected base directory "${expectedBase}". ` +
        'Check your HOME or APPDATA environment variable for path traversal.'
    );
  }

  return settingsPath;
}

type EnvVar = { name: string; value: string };

/**
 * Build environment variables from a profile for VSCode extension.
 * Returns null for providers that cannot be used with VSCode (e.g. openai-compatible).
 */
function buildEnvVarsFromProfile(profile: Profile): EnvVar[] | null {
  // openai-compatible requires the flip-cc proxy which only runs during CLI launch
  if (profile.provider === 'openai-compatible') {
    return null;
  }

  const envVars: EnvVar[] = [];

  // For Anthropic provider with no API key (subscription mode)
  if (profile.provider === 'anthropic' && !profile.apiKey) {
    // Subscription mode: disable extended thinking to prevent errors
    envVars.push({ name: 'CLAUDE_CODE_MAX_THINKING_TOKENS', value: '0' });
    return envVars;
  }

  // API key mode (all providers including non-Anthropic)
  if (profile.apiKey) {
    envVars.push({ name: 'ANTHROPIC_API_KEY', value: profile.apiKey });
  }

  // Base URL for the provider
  if (profile.baseUrl) {
    envVars.push({ name: 'ANTHROPIC_BASE_URL', value: profile.baseUrl });
  }

  // Model if specified
  if (profile.model) {
    envVars.push({ name: 'ANTHROPIC_MODEL', value: profile.model });
  }

  // Extra environment variables from profile
  if (profile.extraEnv) {
    for (const [key, value] of Object.entries(profile.extraEnv)) {
      envVars.push({ name: key, value });
    }
  }

  return envVars;
}

/**
 * Get a display name for the backend based on profile.
 */
function getBackendDisplayName(profile: Profile): string {
  if (profile.provider === 'anthropic') {
    return profile.apiKey ? 'Claude (API Key)' : 'Claude (Subscription)';
  }
  if (profile.provider === 'kimi') {
    return 'Moonshot Kimi 2.5';
  }
  if (profile.provider === 'openrouter') {
    return `OpenRouter${profile.model ? ` (${profile.model.split('/').pop()})` : ''}`;
  }
  return profile.name;
}

/**
 * Check if a profile uses API key mode (requires disableLoginPrompt).
 */
function usesApiKeyMode(profile: Profile): boolean {
  // Anthropic without API key is subscription mode
  if (profile.provider === 'anthropic' && !profile.apiKey) {
    return false;
  }
  // All others use API key
  return true;
}

/**
 * Update settings.json using JSON parse/stringify.
 * Always backs up the file first. Warns and skips if the file is not valid JSON.
 */
function updateSettingsFile(settingsPath: string, envVars: EnvVar[], disableLogin = true): void {
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let rawContent: string;
  if (existsSync(settingsPath)) {
    rawContent = readFileSync(settingsPath, 'utf-8');
    // Back up before any modification with restricted permissions
    writeFileSync(settingsPath + '.flip-cc.bak', rawContent, { encoding: 'utf-8', mode: 0o600 });
  } else {
    rawContent = '{}';
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    console.warn(
      chalk.yellow('Warning: VSCode settings.json is not valid JSON. Skipping write to avoid corruption.'),
    );
    return;
  }

  // Remove any previously managed keys
  delete parsed['claudeCode.environmentVariables'];
  delete parsed['claudeCode.disableLoginPrompt'];

  // Re-insert if we have env vars to write
  if (envVars.length > 0) {
    parsed['claudeCode.environmentVariables'] = envVars;
    if (disableLogin) {
      parsed['claudeCode.disableLoginPrompt'] = true;
    }
  }

  writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Remove claudeCode settings from settings.json
 */
function removeSettings(settingsPath: string): void {
  if (!existsSync(settingsPath)) return;
  updateSettingsFile(settingsPath, []);
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

  // ── Check for profiles ──────────────────────────────────────────────────────
  const profiles = getProfiles();
  if (profiles.length === 0) {
    console.error(chalk.red('Error: No profiles configured.'));
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

  // ── Profile selection ───────────────────────────────────────────────────────
  const defaultProfileId = getDefaultProfileId();

  const profileChoices = profiles.map((profile) => {
    const isDefault = profile.id === defaultProfileId;
    const backendName = getBackendDisplayName(profile);
    const description = profile.model
      ? `Model: ${profile.model}`
      : profile.provider === 'anthropic' && !profile.apiKey
        ? 'Uses claude.ai subscription'
        : undefined;

    return {
      name: `${profile.name}${isDefault ? chalk.green(' [default]') : ''}`,
      value: profile.id,
      description: description || backendName,
    };
  });

  const selectedProfileId = await select<string>({
    message: 'Which profile would you like to use in VSCode?',
    choices: profileChoices,
    default: defaultProfileId,
  });

  const profile = getProfile(selectedProfileId);
  if (!profile) {
    console.error(chalk.red(`Error: Profile "${selectedProfileId}" not found.`));
    process.exit(1);
  }

  // Validate profile is ready
  const validation = validateProfileReady(selectedProfileId);
  if (validation !== true) {
    console.error(chalk.red(`Error: ${validation}`));
    process.exit(1);
  }

  // ── Update settings.json ────────────────────────────────────────────────────
  const envVars = buildEnvVarsFromProfile(profile);

  if (envVars === null) {
    console.error(chalk.red('\nError: openai-compatible profiles require the flip-cc proxy (CLI launch only).'));
    console.error(chalk.yellow('VSCode config is not supported for this provider.'));
    console.error(chalk.dim('Use "flip-cc launch ' + profile.id + '" to run with this profile.'));
    process.exit(1);
  }

  const disableLogin = usesApiKeyMode(profile);

  try {
    updateSettingsFile(settingsPath, envVars, disableLogin);
  } catch (error) {
    console.error(chalk.red('\nError updating VSCode settings:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Bootstrap ~/.claude/ on fresh systems so VSCode doesn't trigger onboarding
  if (disableLogin) {
    const realClaudeDir = join(getHomeDir(), '.claude');
    if (!existsSync(realClaudeDir)) {
      mkdirSync(realClaudeDir, { recursive: true });
      writeFileSync(join(realClaudeDir, '.credentials.json'), '{}', { mode: 0o600 });
    }
  }

  // Clean up any legacy PATH shim silently
  removeLegacyShim();

  // ── Success ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.green('✓ VSCode settings updated successfully!'));
  console.log();
  console.log(chalk.bold('Configuration:'));
  console.log(`  Settings file: ${chalk.cyan(settingsPath)}`);
  console.log(`  Profile: ${chalk.cyan(profile.name)} (${chalk.dim(profile.id)})`);
  console.log(`  Provider: ${getProviderDisplay(profile.provider)}`);
  if (envVars.length > 0) {
    console.log();
    console.log(chalk.bold('Environment variables:'));
    for (const v of envVars) {
      const display = v.name.includes('API_KEY') ? maskApiKey(v.value) : v.value;
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

  console.log(chalk.bold('Switching profiles later:'));
  console.log(`  Run ${chalk.cyan('flip-cc vscode-config')} again to change the profile.\n`);

  console.log(chalk.bold('To remove the configuration:'));
  console.log(`  ${chalk.cyan('flip-cc vscode-config --remove')}\n`);
}
