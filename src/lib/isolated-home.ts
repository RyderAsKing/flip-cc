/**
 * File system operations for creating isolated home directories.
 * Separated from launch.ts business logic for testability.
 */

import {
  mkdtempSync, mkdirSync, cpSync, existsSync, symlinkSync,
  readdirSync, readFileSync, writeFileSync, chmodSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { debug, warn } from './logger.js';
import { getHomeDir } from './utils.js';

/**
 * Create a temp directory with restricted permissions.
 */
export function createTempHome(): string {
  let tempHome: string;
  try {
    tempHome = mkdtempSync(join(tmpdir(), '.fcc-'));
  } catch (err) {
    console.error(chalk.red('Error: Could not create temp directory:'), err instanceof Error ? err.message : err);
    process.exit(1);
  }
  chmodSync(tempHome, 0o700);
  debug('isolated-home', 'Created temp home at', tempHome);
  return tempHome;
}

/**
 * Create ~/.local/bin symlink to the real claude binary.
 */
export function setupLocalBinSymlink(tempHome: string): void {
  const localBinDir = join(tempHome, '.local', 'bin');
  mkdirSync(localBinDir, { recursive: true });

  try {
    const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    const realClaudePath = execSync(whichCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (realClaudePath) {
      const tempClaudePath = join(localBinDir, 'claude');
      symlinkSync(realClaudePath, tempClaudePath);
      debug('isolated-home', 'Symlinked claude binary from', realClaudePath);
    }
  } catch (error) {
    const isNotFoundError =
      error instanceof Error &&
      (error.message.includes('command not found') ||
        error.message.includes('exit code 1'));

    if (isNotFoundError) {
      console.warn(
        chalk.yellow('Warning:') +
          ' Could not find claude binary in PATH. ' +
          'Make sure claude-code is installed globally (npm install -g @anthropic-ai/claude-code)'
      );
    }
    // Ignore other symlink errors (e.g., if already exists)
  }
}

/**
 * Claude Code identifies API keys by their last 20 characters (internal `CT` function).
 * We store the same truncated form so the approved-list lookup matches.
 */
export function keyFingerprint(apiKey: string): string {
  return apiKey.slice(-20);
}

/**
 * Copy and patch ~/.claude.json to pre-approve an API key.
 */
export function setupClaudeJsonConfig(realHome: string, tempHome: string, apiKey: string): void {
  const mainConfigFile = join(realHome, '.claude.json');
  const tempMainConfigFile = join(tempHome, '.claude.json');
  if (existsSync(mainConfigFile)) {
    try {
      cpSync(mainConfigFile, tempMainConfigFile, { force: true });
    } catch (err) {
      warn('isolated-home', `Failed to copy .claude.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const fp = keyFingerprint(apiKey);
  try {
    let claudeConfig: Record<string, unknown> = {};
    if (existsSync(tempMainConfigFile)) {
      claudeConfig = JSON.parse(readFileSync(tempMainConfigFile, 'utf-8'));
    }
    const responses = (claudeConfig.customApiKeyResponses ?? {}) as Record<string, unknown>;
    const approved = Array.isArray(responses.approved) ? responses.approved as string[] : [];
    if (!approved.includes(fp)) {
      approved.push(fp);
    }
    claudeConfig.customApiKeyResponses = { ...responses, approved };
    writeFileSync(tempMainConfigFile, JSON.stringify(claudeConfig, null, 2));
    debug('isolated-home', 'Patched temp .claude.json with key fingerprint');
  } catch (err) {
    console.warn(chalk.yellow('Warning: Could not patch ~/.claude.json:'), err instanceof Error ? err.message : err);
    console.warn(chalk.yellow('You may see a "Detected a custom API key" dialog on launch.'));
  }
}

/**
 * Copy ~/.claude dir (excluding credentials) and selectively copy MCP OAuth.
 */
export function setupClaudeDir(realHome: string, tempHome: string): void {
  const realClaudeDir = join(realHome, '.claude');
  const tempClaudeDir = join(tempHome, '.claude');

  if (!existsSync(realClaudeDir)) return;

  mkdirSync(tempClaudeDir, { recursive: true });

  const entries = readdirSync(realClaudeDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(realClaudeDir, entry.name);
    const destPath = join(tempClaudeDir, entry.name);

    if (entry.name === '.credentials.json') {
      continue;
    }

    try {
      if (entry.isDirectory()) {
        cpSync(srcPath, destPath, { recursive: true, force: true, dereference: false });
      } else {
        cpSync(srcPath, destPath, { force: true, dereference: false });
      }
    } catch (err) {
      warn('isolated-home', `Failed to copy ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Copy only MCP OAuth from credentials file (not claude.ai session)
  const credsFile = join(realClaudeDir, '.credentials.json');
  if (existsSync(credsFile)) {
    try {
      const credsContent = readFileSync(credsFile, 'utf-8');
      const creds = JSON.parse(credsContent);
      const filteredCreds: Record<string, unknown> = {};
      if (creds.mcpOAuth) {
        filteredCreds.mcpOAuth = creds.mcpOAuth;
      }
      if (creds.organizationUuid) {
        filteredCreds.organizationUuid = creds.organizationUuid;
      }
      if (Object.keys(filteredCreds).length > 0) {
        writeFileSync(
          join(tempClaudeDir, '.credentials.json'),
          JSON.stringify(filteredCreds, null, 2)
        );
      }
      debug('isolated-home', 'Filtered credentials copied');
    } catch (err) {
      warn('isolated-home', `Failed to parse credentials file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Patch the real ~/.claude.json to pre-approve an API key.
 * Returns the original content for later restoration.
 */
export function patchRealClaudeJsonApproved(apiKey: string): string | undefined {
  const realHome = getHomeDir();
  const configFile = join(realHome, '.claude.json');
  let original: string | undefined;
  try {
    if (existsSync(configFile)) {
      original = readFileSync(configFile, 'utf-8');
    }
    let config: Record<string, unknown> = {};
    if (original) {
      config = JSON.parse(original);
    }
    const fp = keyFingerprint(apiKey);
    const responses = (config.customApiKeyResponses ?? {}) as Record<string, unknown>;
    const approved = Array.isArray(responses.approved) ? [...(responses.approved as string[])] : [];
    if (!approved.includes(fp)) {
      approved.push(fp);
    }
    const rejected = Array.isArray(responses.rejected)
      ? (responses.rejected as string[]).filter((k) => k !== fp)
      : [];
    config.customApiKeyResponses = { ...responses, approved, rejected };
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    debug('isolated-home', 'Patched real .claude.json with key fingerprint');
  } catch (err) {
    warn('isolated-home', `Failed to patch real .claude.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  return original;
}

/**
 * Restore the real ~/.claude.json to its prior state.
 */
export function restoreRealClaudeJson(originalContent: string | undefined): void {
  const realHome = getHomeDir();
  const configFile = join(realHome, '.claude.json');
  try {
    if (originalContent !== undefined) {
      writeFileSync(configFile, originalContent);
      debug('isolated-home', 'Restored real .claude.json');
    }
  } catch (err) {
    warn('isolated-home', `Failed to restore .claude.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Creates an isolated home directory for API key mode.
 */
export function createIsolatedHomeForApiKey(apiKey: string): string {
  const realHome = getHomeDir();
  const tempHome = createTempHome();
  setupLocalBinSymlink(tempHome);
  setupClaudeJsonConfig(realHome, tempHome, apiKey);
  setupClaudeDir(realHome, tempHome);
  return tempHome;
}
