#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupCommand } from './commands/setup.js';
import { launchCommand } from './commands/launch.js';
import { vscodeShimCommand } from './commands/vscode-config.js';

const program = new Command();

program
  .name('flip-cc')
  .description('CLI launcher for Claude Code with Anthropic/Moonshot Kimi switching')
  .version('0.1.0');

program
  .command('setup')
  .description('Configure flip-cc (auth modes and API keys)')
  .action(async () => {
    try {
      await setupCommand();
    } catch (error) {
      console.error(chalk.red('Setup failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('launch')
  .description('Launch Claude Code with the specified provider')
  .argument('<target>', 'Target provider: claude or kimi')
  .option('--key', 'Use saved Anthropic API key (for claude target)', false)
  .action(async (target, options) => {
    try {
      await launchCommand(target, options);
    } catch (error) {
      console.error(chalk.red('Launch failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('vscode-config')
  .description('Configure the Claude Code VSCode extension to use a specific backend')
  .option('--remove', 'Remove the configuration instead of setting it', false)
  .action(async (options) => {
    try {
      await vscodeShimCommand(options);
    } catch (error) {
      console.error(chalk.red('vscode-config failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Parse arguments
program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red('Unexpected error:'), error instanceof Error ? error.message : error);
  process.exit(1);
});
