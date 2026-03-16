import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync, symlinkSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join, delimiter } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { getConfig, needsMigration, migrateToProfiles } from '../lib/config.js';
import { spawnWithInheritance } from '../lib/spawn.js';
import { validateProfileReady } from '../lib/validate.js';
import { getProfile, getDefaultProfileId, initializeDefaultProfiles } from '../lib/profiles.js';
import { needsProxy, startProxy, type ProxyHandle } from '../lib/proxy.js';
import type { Profile } from '../types.js';


export interface LaunchOptions {
  key?: boolean;
}

function createTempHome(): string {
  let tempHome: string;
  try {
    tempHome = mkdtempSync(join(tmpdir(), '.fcc-'));
  } catch (err) {
    console.error(chalk.red('Error: Could not create temp directory:'), err instanceof Error ? err.message : err);
    process.exit(1);
  }
  // Ensure temp directory is only accessible by owner, regardless of system umask.
  chmodSync(tempHome, 0o700);
  return tempHome;
}

function setupLocalBinSymlink(tempHome: string): void {
  // Create ~/.local/bin to suppress PATH warnings
  const localBinDir = join(tempHome, '.local', 'bin');
  mkdirSync(localBinDir, { recursive: true });

  // Create symlink to actual claude binary for native install validation
  // This fixes "installMethod is native, but claude command not found" error
  try {
    const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    const realClaudePath = execSync(whichCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (realClaudePath) {
      const tempClaudePath = join(localBinDir, 'claude');
      symlinkSync(realClaudePath, tempClaudePath);
    }
  } catch (error) {
    // Check if claude is not found vs other errors
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

function setupClaudeJsonConfig(realHome: string, tempHome: string, apiKey: string): void {
  // Copy main config file and pre-approve the API key so Claude Code skips
  // the "Detected a custom API key in your environment" interactive prompt.
  // Claude Code tracks approved keys in ~/.claude.json under customApiKeyResponses.approved.
  const mainConfigFile = join(realHome, '.claude.json');
  const tempMainConfigFile = join(tempHome, '.claude.json');
  if (existsSync(mainConfigFile)) {
    try {
      cpSync(mainConfigFile, tempMainConfigFile, { force: true });
    } catch {
      // Ignore copy errors
    }
  }
  // Inject the API key into the approved list (write file whether or not original existed)
  try {
    let claudeConfig: Record<string, unknown> = {};
    if (existsSync(tempMainConfigFile)) {
      claudeConfig = JSON.parse(readFileSync(tempMainConfigFile, 'utf-8'));
    }
    const responses = (claudeConfig.customApiKeyResponses ?? {}) as Record<string, unknown>;
    const approved = Array.isArray(responses.approved) ? responses.approved as string[] : [];
    if (!approved.includes(apiKey)) {
      approved.push(apiKey);
    }
    claudeConfig.customApiKeyResponses = { ...responses, approved };
    writeFileSync(tempMainConfigFile, JSON.stringify(claudeConfig, null, 2));
  } catch (err) {
    console.warn(chalk.yellow('Warning: Could not patch ~/.claude.json:'), err instanceof Error ? err.message : err);
    console.warn(chalk.yellow('You may see a "Detected a custom API key" dialog on launch.'));
  }
}

function setupClaudeDir(realHome: string, tempHome: string): void {
  // Create .claude directory structure
  const realClaudeDir = join(realHome, '.claude');
  const tempClaudeDir = join(tempHome, '.claude');

  if (existsSync(realClaudeDir)) {
    mkdirSync(tempClaudeDir, { recursive: true });

    // Copy all files/directories except credentials file
    const entries = readdirSync(realClaudeDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(realClaudeDir, entry.name);
      const destPath = join(tempClaudeDir, entry.name);

      // Skip credentials file - we'll handle it separately
      if (entry.name === '.credentials.json') {
        continue;
      }

      try {
        if (entry.isDirectory()) {
          cpSync(srcPath, destPath, { recursive: true, force: true, dereference: false });
        } else {
          cpSync(srcPath, destPath, { force: true, dereference: false });
        }
      } catch {
        // Ignore copy errors for individual files
      }
    }

    // Copy only MCP OAuth from credentials file (not claude.ai session)
    const credsFile = join(realClaudeDir, '.credentials.json');
    if (existsSync(credsFile)) {
      try {
        const credsContent = readFileSync(credsFile, 'utf-8');
        const creds = JSON.parse(credsContent);
        // Create minimal credentials file with only MCP OAuth
        const filteredCreds: Record<string, unknown> = {};
        if (creds.mcpOAuth) {
          filteredCreds.mcpOAuth = creds.mcpOAuth;
        }
        // Also copy organizationUuid if present (may be needed for some features)
        if (creds.organizationUuid) {
          filteredCreds.organizationUuid = creds.organizationUuid;
        }
        if (Object.keys(filteredCreds).length > 0) {
          writeFileSync(
            join(tempClaudeDir, '.credentials.json'),
            JSON.stringify(filteredCreds, null, 2)
          );
        }
      } catch {
        // Ignore credentials parsing errors
      }
    }
  }
}

/**
 * Creates an isolated home directory for API key mode that excludes claude.ai credentials.
 * This prevents the auth conflict warning when using API key mode.
 */
function createIsolatedHomeForApiKey(apiKey: string): string {
  const realHome = process.env.HOME || process.env.USERPROFILE || tmpdir();
  const tempHome = createTempHome();
  setupLocalBinSymlink(tempHome);
  setupClaudeJsonConfig(realHome, tempHome, apiKey);
  setupClaudeDir(realHome, tempHome);
  return tempHome;
}

/**
 * Build environment variable overrides for a profile.
 */
function buildEnvOverrides(profile: Profile, options: LaunchOptions): Record<string, string | undefined> {
  const envOverrides: Record<string, string | undefined> = {};

  // Handle Anthropic provider
  if (profile.provider === 'anthropic') {
    const useApiKey = options.key && profile.apiKey;

    if (useApiKey) {
      // API key mode: set the key
      envOverrides['ANTHROPIC_API_KEY'] = profile.apiKey;
    } else if (!profile.apiKey) {
      // Subscription mode: explicitly remove ANTHROPIC_API_KEY to avoid conflicts
      envOverrides['ANTHROPIC_API_KEY'] = undefined;
    } else {
      // Has API key but --key flag not used - default to subscription mode
      envOverrides['ANTHROPIC_API_KEY'] = undefined;
    }

    // Set base URL if provided
    if (profile.baseUrl) {
      envOverrides['ANTHROPIC_BASE_URL'] = profile.baseUrl;
    }

    // Set model if provided
    if (profile.model) {
      envOverrides['ANTHROPIC_MODEL'] = profile.model;
    }
  } else {
    // Non-Anthropic providers: always use API key with Anthropic-compatible env vars
    // First clear any existing ANTHROPIC_API_KEY from parent environment to avoid conflicts
    envOverrides['ANTHROPIC_API_KEY'] = profile.apiKey || undefined;

    // Set base URL for non-Anthropic providers
    if (profile.baseUrl) {
      envOverrides['ANTHROPIC_BASE_URL'] = profile.baseUrl;
    }

    // Set model if provided
    if (profile.model) {
      envOverrides['ANTHROPIC_MODEL'] = profile.model;
    }
  }

  // Apply extra environment variables from profile
  // Validate each key to prevent injection of dangerous dynamic linker variables.
  const BLOCKED_ENV_KEYS = new Set([
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
  ]);
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
      envOverrides[key] = value;
    }
  }

  return envOverrides;
}

/**
 * Determine if a profile needs isolated home directory.
 * Isolation is needed when using API keys to avoid conflicts with claude.ai credentials.
 */
function needsIsolatedHome(profile: Profile, options: LaunchOptions): boolean {
  // Anthropic with API key and --key flag
  if (profile.provider === 'anthropic' && options.key && profile.apiKey) {
    return true;
  }

  // Non-Anthropic providers always use API keys
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

  // Build environment overrides
  const envOverrides = buildEnvOverrides(profile, options);

  // Start proxy first (if needed) so we have the per-session auth token before
  // creating the isolated home directory — the token must be pre-approved in .claude.json.
  let proxyHandle: ProxyHandle | undefined;
  if (needsProxy(profile)) {
    proxyHandle = await startProxy(profile);
    // Override ANTHROPIC_BASE_URL to point at the local proxy.
    envOverrides['ANTHROPIC_BASE_URL'] = proxyHandle.baseUrl;
    // Use the per-session auth token as the API key. The proxy verifies this token
    // on every request; it uses profile.apiKey for actual upstream auth.
    envOverrides['ANTHROPIC_API_KEY'] = proxyHandle.authToken;
  }

  // Determine if we need isolated home
  const useIsolatedHome = needsIsolatedHome(profile, options);
  let isolatedHome: string | undefined;

  // For proxy profiles, pre-approve the per-session auth token so Claude Code skips
  // the "Detected a custom API key" dialog. For direct API key profiles, pre-approve
  // the actual profile key.
  const isolatedHomeKey = proxyHandle ? proxyHandle.authToken : profile.apiKey;

  if (useIsolatedHome) {
    isolatedHome = createIsolatedHomeForApiKey(isolatedHomeKey);
    envOverrides['HOME'] = isolatedHome;

    // Add ~/.local/bin to PATH to suppress warnings
    const localBinPath = join(isolatedHome, '.local', 'bin');
    envOverrides['PATH'] = `${localBinPath}${delimiter}${process.env.PATH || ''}`;

    // Also update USERPROFILE for Windows compatibility
    if (process.platform === 'win32') {
      envOverrides['USERPROFILE'] = isolatedHome;
    }
  }

  // Log launch message
  if (profile.provider === 'anthropic' && !profile.apiKey) {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name} (subscription)...`));
  } else if (profile.provider === 'anthropic' && options.key) {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name} (API key)...`));
  } else {
    console.log(chalk.blue(`Launching Claude Code with ${profile.name}...`));
  }

  try {
    // Spawn claude command
    await spawnWithInheritance('claude', [], {
      envOverrides: Object.keys(envOverrides).length > 0 ? envOverrides : undefined,
    });
  } catch (error) {
    // Error is already logged by spawn, just exit with error code
    process.exit(1);
  } finally {
    // Stop proxy if it was started
    if (proxyHandle) {
      await proxyHandle.stop().catch(() => {/* ignore cleanup errors */});
    }
    // Clean up temp home directory.
    // Use rmSync with force:true directly — it handles non-existence gracefully
    // and avoids the TOCTOU race that existsSync introduces.
    if (isolatedHome) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch (err) {
        // Warn so that leftover temp directories (which may contain sensitive
        // copies of ~/.claude config) are not silently abandoned.
        process.stderr.write(
          `Warning: failed to clean up isolated home directory "${isolatedHome}": ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }
}
