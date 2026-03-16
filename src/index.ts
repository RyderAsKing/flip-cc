#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupCommand } from './commands/setup/index.js';
import { launchCommand } from './commands/launch.js';
import { vscodeShimCommand } from './commands/vscode-config.js';
import { statsCommand } from './commands/stats.js';
import {
  profileListCommand,
  profileAddCommand,
  profileEditCommand,
  profileRemoveCommand,
  profileSetDefaultCommand,
} from './commands/profile.js';
import packageJson from '../package.json' with { type: 'json' };

const program = new Command();

program
  .name('flip-cc')
  .description('CLI launcher for Claude Code with Anthropic/Moonshot Kimi switching')
  .version(packageJson.version);

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
  .description('Launch Claude Code with the specified profile')
  .argument('[profile]', 'Profile ID to use (defaults to default profile)')
  .option('--key', 'Use API key for Anthropic profiles (subscription mode by default)', false)
  .action(async (profile, options) => {
    try {
      // Default to 'claude' profile if none specified
      await launchCommand(profile || 'claude', options);
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

program
  .command('stats')
  .description('Show session and usage statistics')
  .argument('[profile]', 'Filter by profile ID')
  .option('--clear', 'Clear statistics')
  .action(async (profileId, options) => {
    try {
      await statsCommand(profileId, options);
    } catch (error) {
      console.error(chalk.red('Stats failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Profile management commands
const profileCommand = program
  .command('profile')
  .description('Manage flip-cc profiles');

profileCommand
  .command('list')
  .description('List all configured profiles')
  .action(async () => {
    try {
      await profileListCommand();
    } catch (error) {
      console.error(chalk.red('Profile list failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

profileCommand
  .command('add')
  .description('Add a new profile interactively')
  .action(async () => {
    try {
      await profileAddCommand();
    } catch (error) {
      console.error(chalk.red('Profile add failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

profileCommand
  .command('edit')
  .description('Edit an existing profile')
  .argument('[id]', 'Profile ID to edit (interactive selector if not provided)')
  .action(async (id) => {
    try {
      await profileEditCommand(id);
    } catch (error) {
      console.error(chalk.red('Profile edit failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

profileCommand
  .command('remove')
  .description('Remove a profile')
  .argument('[id]', 'Profile ID to remove (interactive selector if not provided)')
  .action(async (id) => {
    try {
      await profileRemoveCommand(id);
    } catch (error) {
      console.error(chalk.red('Profile remove failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

profileCommand
  .command('set-default')
  .description('Set the default profile')
  .argument('[id]', 'Profile ID to set as default (interactive selector if not provided)')
  .action(async (id) => {
    try {
      await profileSetDefaultCommand(id);
    } catch (error) {
      console.error(chalk.red('Profile set-default failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Parse arguments
program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red('Unexpected error:'), error instanceof Error ? error.message : error);
  process.exit(1);
});
