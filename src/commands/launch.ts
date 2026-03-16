import { rmSync } from 'fs';
import { join, delimiter } from 'path';
import chalk from 'chalk';
import { getConfig, needsMigration, migrateToProfiles } from '../lib/config.js';
import { spawnWithInheritance } from '../lib/spawn.js';
import { validateProfileReady } from '../lib/validate.js';
import { getProfile, getDefaultProfileId, initializeDefaultProfiles } from '../lib/profiles.js';
import { needsProxy, startProxy, type ProxyHandle } from '../lib/proxy.js';
import { createIsolatedHomeForApiKey, patchRealClaudeJsonApproved, restoreRealClaudeJson } from '../lib/isolated-home.js';
import { debug } from '../lib/logger.js';
import type { Profile } from '../types.js';


export interface LaunchOptions {
  key?: boolean;
}

/**
 * Environment variable names that are blocked for security reasons.
 */
const BLOCKED_ENV_KEYS = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

/**
 * Check if a string contains control characters (excluding common whitespace).
 */
function hasControlChars(value: string): boolean {
  return /[\x00-\x08\x0e-\x1f]/.test(value);
}

/**
 * Build environment variable overrides for a profile.
 */
function buildEnvOverrides(profile: Profile, options: LaunchOptions): Record<string, string | undefined> {
  const envOverrides: Record<string, string | undefined> = {};

  if (profile.provider === 'anthropic') {
    const useApiKey = options.key && profile.apiKey;

    if (useApiKey) {
      envOverrides['ANTHROPIC_API_KEY'] = profile.apiKey;
    } else {
      envOverrides['ANTHROPIC_API_KEY'] = undefined;
    }

    if (profile.baseUrl) {
      envOverrides['ANTHROPIC_BASE_URL'] = profile.baseUrl;
    }
    if (profile.model) {
      envOverrides['ANTHROPIC_MODEL'] = profile.model;
    }
  } else {
    envOverrides['ANTHROPIC_API_KEY'] = profile.apiKey || undefined;

    if (profile.baseUrl) {
      envOverrides['ANTHROPIC_BASE_URL'] = profile.baseUrl;
    }
    if (profile.model) {
      envOverrides['ANTHROPIC_MODEL'] = profile.model;
    }
  }

  // Apply extra environment variables from profile
  if (profile.extraEnv) {
    for (const [key, value] of Object.entries(profile.extraEnv)) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        console.warn(chalk.yellow(`Warning: skipping extraEnv key "${key}" — invalid environment variable name.`));
        continue;
      }
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) {
        console.warn(chalk.yellow(`Warning: skipping extraEnv key "${key}" — this variable is blocked for security reasons.`));
        continue;
      }
      if (hasControlChars(value)) {
        console.warn(chalk.yellow(`Warning: skipping extraEnv key "${key}" — value contains control characters.`));
        continue;
      }
      envOverrides[key] = value;
    }
  }

  debug('launch', 'Env overrides:', Object.keys(envOverrides).join(', '));
  return envOverrides;
}

/**
 * Determine if a profile needs isolated home directory.
 */
function needsIsolatedHome(profile: Profile, options: LaunchOptions): boolean {
  if (profile.provider === 'anthropic' && options.key && profile.apiKey) {
    return true;
  }
  if (profile.provider !== 'anthropic' && profile.apiKey) {
    return true;
  }
  return false;
}

/**
 * Launch Claude Code with the specified profile.
 */
export async function launchCommand(profileId: string, options: LaunchOptions): Promise<void> {
  // Migrate legacy config if needed
  if (needsMigration()) {
    await migrateToProfiles();
  }

  // Initialize default profiles if none exist
  initializeDefaultProfiles();

  // Resolve profile: if profileId not provided or not found, use default
  let profile = getProfile(profileId);

  if (!profile) {
    const defaultId = getDefaultProfileId();
    if (defaultId && defaultId !== profileId) {
      console.log(chalk.yellow(`Profile "${profileId}" not found. Using default profile "${defaultId}".`));
      profile = getProfile(defaultId);
    }
  }

  if (!profile) {
    console.error(chalk.red(`Error: Profile "${profileId}" not found and no default profile set.`));
    console.error(chalk.yellow('Run "flip-cc profile list" to see available profiles.'));
    console.error(chalk.yellow('Run "flip-cc setup" to configure profiles.'));
    process.exit(1);
  }

  // Validate profile is ready
  const validation = validateProfileReady(profile.id);
  if (validation !== true) {
    console.error(chalk.red(`Error: ${validation}`));
    process.exit(1);
  }

  debug('launch', `Using profile "${profile.id}" (${profile.provider})`);

  // Build environment overrides
  const envOverrides = buildEnvOverrides(profile, options);

  // Start proxy first (if needed) so we have the per-session auth token before
  // creating the isolated home directory — the token must be pre-approved in .claude.json.
  let proxyHandle: ProxyHandle | undefined;
  if (needsProxy(profile)) {
    proxyHandle = await startProxy(profile);
    envOverrides['ANTHROPIC_BASE_URL'] = proxyHandle.baseUrl;
    envOverrides['ANTHROPIC_API_KEY'] = proxyHandle.authToken;
    debug('launch', `Proxy started on ${proxyHandle.baseUrl}`);
  }

  // Determine if we need isolated home
  const useIsolatedHome = needsIsolatedHome(profile, options);
  let isolatedHome: string | undefined;

  const isolatedHomeKey = proxyHandle ? proxyHandle.authToken : profile.apiKey;

  if (useIsolatedHome) {
    isolatedHome = createIsolatedHomeForApiKey(isolatedHomeKey);
    envOverrides['HOME'] = isolatedHome;

    const localBinPath = join(isolatedHome, '.local', 'bin');
    envOverrides['PATH'] = `${localBinPath}${delimiter}${process.env.PATH || ''}`;

    if (process.platform === 'win32') {
      envOverrides['USERPROFILE'] = isolatedHome;
    }
    debug('launch', `Isolated home at ${isolatedHome}`);
  }

  // Log launch message
  if (profile.provider === 'anthropic' && !profile.apiKey) {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name} (subscription)...`));
  } else if (profile.provider === 'anthropic' && options.key) {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name} (API key)...`));
  } else {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name}...`));
  }

  // Belt-and-suspenders: also patch the real ~/.claude.json
  let originalRealClaudeJson: string | undefined;
  if (isolatedHomeKey) {
    originalRealClaudeJson = patchRealClaudeJsonApproved(isolatedHomeKey);
  }

  try {
    await spawnWithInheritance('claude', [], {
      envOverrides: Object.keys(envOverrides).length > 0 ? envOverrides : undefined,
    });
  } catch (error) {
    process.exit(1);
  } finally {
    // Restore real ~/.claude.json to its original state
    if (isolatedHomeKey) {
      restoreRealClaudeJson(originalRealClaudeJson);
    }
    // Stop proxy if it was started
    if (proxyHandle) {
      await proxyHandle.stop().catch(() => {/* ignore cleanup errors */});
    }
    // Clean up temp home directory
    if (isolatedHome) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
        debug('launch', 'Cleaned up isolated home');
      } catch (err) {
        process.stderr.write(
          `Warning: failed to clean up isolated home directory "${isolatedHome}": ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }
}
