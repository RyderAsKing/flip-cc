import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync, symlinkSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { getConfig, needsMigration, migrateToProfiles } from '../lib/config.js';
import { spawnWithInheritance } from '../lib/spawn.js';
import { validateProfileReady } from '../lib/validate.js';
import { getProfile, getDefaultProfileId, initializeDefaultProfiles } from '../lib/profiles.js';
import type { Profile } from '../types.js';

export interface LaunchOptions {
  key?: boolean;
}

/**
 * Creates an isolated home directory for API key mode that excludes claude.ai credentials.
 * This prevents the auth conflict warning when using API key mode.
 */
function createIsolatedHomeForApiKey(apiKey: string): string {
  const realHome = process.env.HOME || process.env.USERPROFILE || tmpdir();
  const tempHome = mkdtempSync(join(tmpdir(), 'flip-cc-apikey-'));

  // Create ~/.local/bin to suppress PATH warnings
  const localBinDir = join(tempHome, '.local', 'bin');
  mkdirSync(localBinDir, { recursive: true });

  // Create symlink to actual claude binary for native install validation
  // This fixes "installMethod is native, but claude command not found" error
  try {
    const realClaudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
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
  } catch {
    // Ignore config patching errors — worst case the dialog appears
  }
  
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
          cpSync(srcPath, destPath, { recursive: true, force: true });
        } else {
          cpSync(srcPath, destPath, { force: true });
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
  if (profile.extraEnv) {
    for (const [key, value] of Object.entries(profile.extraEnv)) {
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

  // Determine if we need isolated home
  const useIsolatedHome = needsIsolatedHome(profile, options);
  let isolatedHome: string | undefined;

  if (useIsolatedHome) {
    isolatedHome = createIsolatedHomeForApiKey(profile.apiKey);
    envOverrides['HOME'] = isolatedHome;

    // Add ~/.local/bin to PATH to suppress warnings
    const localBinPath = join(isolatedHome, '.local', 'bin');
    envOverrides['PATH'] = `${localBinPath}:${process.env.PATH || ''}`;

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
    // Clean up temp home directory
    if (isolatedHome && existsSync(isolatedHome)) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
