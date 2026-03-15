import { confirm, password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getConfig, setConfig, isSetupComplete } from '../lib/config.js';
import { validateApiKey } from '../lib/validate.js';
import type { AuthMode } from '../types.js';

export async function setupCommand(): Promise<void> {
  // Check if already set up
  if (isSetupComplete()) {
    const redo = await confirm({
      message: 'Setup already complete. Redo setup?',
      default: false,
    });
    if (!redo) {
      console.log(chalk.yellow('Setup cancelled.'));
      return;
    }
  }

  // Step 1: Select auth mode for Claude
  const authMode = await select<AuthMode>({
    message: 'How do you want to authenticate with Claude Code?',
    choices: [
      {
        name: 'Subscription (default)',
        value: 'subscription',
        description: 'Use your Anthropic subscription',
      },
      {
        name: 'API Key',
        value: 'api-key',
        description: 'Use an Anthropic API key',
      },
    ],
  });

  let anthropicApiKey: string | undefined;

  // Step 2: If API key mode, prompt for key
  if (authMode === 'api-key') {
    anthropicApiKey = await password({
      message: 'Enter your Anthropic API key:',
      mask: '*',
      validate: (value) => validateApiKey(value, 'anthropic'),
    });
  }

  // Step 3: Configure Kimi?
  const configureKimi = await confirm({
    message: 'Do you want to configure Moonshot Kimi 2.5?',
    default: true,
  });

  let kimiApiKey: string | undefined;

  if (configureKimi) {
    kimiApiKey = await password({
      message: 'Enter your Moonshot Kimi API key:',
      mask: '*',
      validate: (value) => validateApiKey(value, 'kimi'),
    });
  }

  // Step 4: Save configuration
  setConfig({
    claudeAuthMode: authMode,
    ...(anthropicApiKey && { anthropicApiKey }),
    ...(kimiApiKey && { kimiApiKey }),
    setupComplete: true,
  });

  // Success summary
  console.log();
  console.log(chalk.green('✓ Setup complete!'));
  console.log();
  console.log(chalk.bold('Configuration:'));
  console.log(`  Claude Auth Mode: ${authMode === 'subscription' ? chalk.blue('Subscription') : chalk.blue('API Key')}`);
  if (authMode === 'api-key' && anthropicApiKey) {
    console.log(`  Anthropic API Key: ${chalk.gray('****' + anthropicApiKey.slice(-4))}`);
  }
  if (configureKimi && kimiApiKey) {
    console.log(`  Kimi API Key: ${chalk.gray('****' + kimiApiKey.slice(-4))}`);
  }
  console.log();
  console.log(chalk.dim('You can now use:'));
  console.log(chalk.dim('  flip-cc launch claude     # Launch with Claude (subscription or saved API key)'));
  console.log(chalk.dim('  flip-cc launch claude --key  # Launch with saved Anthropic API key'));
  console.log(chalk.dim('  flip-cc launch kimi       # Launch with Moonshot Kimi 2.5'));
}
