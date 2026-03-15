import { checkbox, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getConfig, setConfig, isSetupComplete } from '../../lib/config.js';
import { addProfile, setDefaultProfile } from '../../lib/profiles.js';
import type { ProviderType } from '../../types.js';
import { configureAnthropic } from './anthropic.js';
import { configureKimi } from './kimi.js';
import { configureOpenRouter } from './openrouter.js';
import { configureOpenAICompatible } from './openai-compatible.js';

export { configureAnthropic } from './anthropic.js';
export { configureKimi } from './kimi.js';
export { configureOpenRouter } from './openrouter.js';
export { configureOpenAICompatible } from './openai-compatible.js';

const PROVIDER_CHOICES: { value: ProviderType; name: string; description: string }[] = [
  {
    value: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude via subscription or API key',
  },
  {
    value: 'kimi',
    name: 'Moonshot Kimi 2.5',
    description: 'Kimi coding model via Moonshot API',
  },
  {
    value: 'openrouter',
    name: 'OpenRouter',
    description: 'Access multiple AI models through OpenRouter',
  },
  {
    value: 'openai-compatible',
    name: 'OpenAI-Compatible (any provider: NVIDIA NIM, Groq, Together AI, Ollama…)',
    description: 'Any provider with an OpenAI-compatible API',
  },
];

/**
 * Main setup command - guides user through creating initial profiles.
 */
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

    // Warn that existing profiles will be cleared
    const config = getConfig();
    if (config.profiles && config.profiles.length > 0) {
      const clearExisting = await confirm({
        message: `This will clear ${config.profiles.length} existing profile(s). Continue?`,
        default: false,
      });
      if (!clearExisting) {
        console.log(chalk.yellow('Setup cancelled.'));
        return;
      }
      // Actually clear existing profiles so re-setup starts fresh
      setConfig({ profiles: [] });
    }
  }

  console.log();
  console.log(chalk.bold('Welcome to flip-cc setup!'));
  console.log(chalk.dim('Configure which AI providers you want to use with Claude Code.'));
  console.log();

  // Select providers to configure
  const selectedProviders = await checkbox<ProviderType>({
    message: 'Which providers do you want to configure?',
    choices: PROVIDER_CHOICES,
    validate: (choices) => choices.length > 0 || 'Please select at least one provider',
  });

  if (selectedProviders.length === 0) {
    console.log(chalk.yellow('No providers selected. Setup cancelled.'));
    return;
  }

  // Track created profiles
  const createdProfiles: { id: string; name: string; provider: ProviderType }[] = [];
  const errors: string[] = [];

  // Configure each selected provider
  for (const provider of selectedProviders) {
    console.log();
    console.log(chalk.bold(`\nConfiguring ${PROVIDER_CHOICES.find((p) => p.value === provider)?.name}...`));

    try {
      let result: { profileId: string; profileName: string; config: unknown } | null = null;

      switch (provider) {
        case 'anthropic':
          result = await configureAnthropic();
          break;
        case 'kimi':
          result = await configureKimi();
          break;
        case 'openrouter':
          result = await configureOpenRouter();
          break;
        case 'openai-compatible':
          result = await configureOpenAICompatible();
          break;
      }

      if (result) {
        // Check if profile ID already exists
        const config = getConfig();
        const existingProfile = config.profiles?.find((p) => p.id === result!.profileId);
        if (existingProfile) {
          errors.push(`Profile "${result.profileId}" already exists. Skipping ${provider}.`);
          continue;
        }

        addProfile(result.config as Parameters<typeof addProfile>[0]);
        createdProfiles.push({ id: result.profileId, name: result.profileName, provider });
      }
    } catch (error) {
      errors.push(`Failed to configure ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // If no profiles were created, abort
  if (createdProfiles.length === 0) {
    console.log();
    console.log(chalk.red('✗ No profiles were created. Setup failed.'));
    if (errors.length > 0) {
      console.log();
      console.log(chalk.yellow('Errors:'));
      errors.forEach((e) => console.log(chalk.red(`  • ${e}`)));
    }
    return;
  }

  // Ask which profile should be default
  let defaultProfileId: string | undefined;
  if (createdProfiles.length === 1) {
    defaultProfileId = createdProfiles[0]!.id;
  } else {
    console.log();
    defaultProfileId = await select({
      message: 'Which profile should be the default?',
      choices: createdProfiles.map((p) => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
        description: PROVIDER_CHOICES.find((c) => c.value === p.provider)!.description,
      })),
    });
  }

  // Set default profile
  if (defaultProfileId) {
    setDefaultProfile(defaultProfileId);
  }

  // Mark setup as complete
  setConfig({ setupComplete: true });

  // Success summary
  console.log();
  console.log(chalk.green('✓ Setup complete!'));
  console.log();
  console.log(chalk.bold('Created profiles:'));
  for (const profile of createdProfiles) {
    const isDefault = profile.id === defaultProfileId;
    console.log(`  ${isDefault ? chalk.green('★') : ' '} ${chalk.cyan(profile.name)} (${chalk.dim(profile.id)})`);
  }
  console.log();
  console.log(chalk.dim('Usage:'));
  console.log(chalk.dim(`  flip-cc launch                    # Launch with default profile (${defaultProfileId})`));
  console.log(chalk.dim('  flip-cc launch <profile-id>       # Launch with specific profile'));
  console.log(chalk.dim('  flip-cc profile list              # List all profiles'));
  console.log(chalk.dim('  flip-cc profile add               # Add another profile'));

  if (errors.length > 0) {
    console.log();
    console.log(chalk.yellow('Warnings:'));
    errors.forEach((e) => console.log(chalk.yellow(`  • ${e}`)));
  }
}
