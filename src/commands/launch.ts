import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync, symlinkSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { getConfig } from '../lib/config.js';
import { spawnWithInheritance } from '../lib/spawn.js';
import { validateSetupComplete } from '../lib/validate.js';
import type { LaunchTarget } from '../types.js';

export interface LaunchOptions {
  key?: boolean;
}

/**
 * Creates an isolated home directory for API key mode that excludes claude.ai credentials.
 * This prevents the auth conflict warning when using API key mode.
 */
function createIsolatedHomeForApiKey(): string {
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

  // Copy main config file if it exists (excludes credentials)
  const mainConfigFile = join(realHome, '.claude.json');
  if (existsSync(mainConfigFile)) {
    try {
      cpSync(mainConfigFile, join(tempHome, '.claude.json'), { force: true });
    } catch {
      // Ignore copy errors
    }
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

export async function launchCommand(target: string, options: LaunchOptions): Promise<void> {
  // Validate target
  if (target !== 'claude' && target !== 'kimi') {
    console.error(chalk.red(`Error: Unknown target "${target}". Use 'claude' or 'kimi'.`));
    process.exit(1);
  }

  const launchTarget = target as LaunchTarget;
  const config = getConfig();

  // Validate setup is complete
  const setupValidation = validateSetupComplete(config, launchTarget, options.key);
  if (setupValidation !== true) {
    console.error(chalk.red(`Error: ${setupValidation}`));
    process.exit(1);
  }

  const envOverrides: Record<string, string | undefined> = {};
  let isolatedHome: string | undefined;

  // Branch logic based on target
  if (launchTarget === 'kimi') {
    // Kimi: inject env vars to route Claude Code to Kimi API
    if (!config.kimiApiKey) {
      console.error(chalk.red('Error: Kimi API key not configured.'));
      process.exit(1);
    }

    envOverrides['ENABLE_TOOL_SEARCH'] = 'false';
    envOverrides['ANTHROPIC_BASE_URL'] = 'https://api.kimi.com/coding/';
    envOverrides['ANTHROPIC_API_KEY'] = config.kimiApiKey;

    // Create isolated home to avoid auth conflict with claude.ai credentials
    isolatedHome = createIsolatedHomeForApiKey();
    envOverrides['HOME'] = isolatedHome;
    // Add ~/.local/bin to PATH to suppress warnings
    const localBinPath = join(isolatedHome, '.local', 'bin');
    envOverrides['PATH'] = `${localBinPath}:${process.env.PATH || ''}`;
    // Also update USERPROFILE for Windows compatibility
    if (process.platform === 'win32') {
      envOverrides['USERPROFILE'] = isolatedHome;
    }

    console.log(chalk.blue('Launching Claude Code with Moonshot Kimi 2.5...'));
  } else if (launchTarget === 'claude') {
    if (options.key) {
      // Use saved Anthropic API key
      if (!config.anthropicApiKey) {
        console.error(chalk.red('Error: Anthropic API key not configured.'));
        process.exit(1);
      }

      envOverrides['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
      
      // For API key mode, also isolate home to avoid conflict with subscription
      isolatedHome = createIsolatedHomeForApiKey();
      envOverrides['HOME'] = isolatedHome;
      // Add ~/.local/bin to PATH to suppress warnings
      const localBinPath = join(isolatedHome, '.local', 'bin');
      envOverrides['PATH'] = `${localBinPath}:${process.env.PATH || ''}`;
      if (process.platform === 'win32') {
        envOverrides['USERPROFILE'] = isolatedHome;
      }
      
      console.log(chalk.blue('Launching Claude Code with API key...'));
    } else {
      // Subscription mode: explicitly remove ANTHROPIC_API_KEY to avoid conflicts
      envOverrides['ANTHROPIC_API_KEY'] = undefined;
      console.log(chalk.blue('Launching Claude Code with subscription auth...'));
    }
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
