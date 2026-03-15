import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getConfig, setConfig, isSetupComplete } from '../lib/config.js';
import { validateApiKey } from '../lib/validate.js';
import {
  addProfile,
  createProfile,
  setDefaultProfile,
  getProviderBaseUrl,
  getProviderDefaultModel,
  getProviderExtraEnv,
  validateProfileId,
} from '../lib/profiles.js';
import type { AuthMode, ProviderType } from '../types.js';

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
    name: 'OpenAI-compatible API',
    description: 'Custom OpenAI-compatible endpoint',
  },
];

/**
 * Configure Anthropic provider - supports both subscription and API key modes.
 */
async function configureAnthropic(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const authMode = await select<AuthMode>({
    message: 'How do you want to authenticate with Anthropic?',
    choices: [
      {
        name: 'Subscription (claude.ai)',
        value: 'subscription',
        description: 'Use your existing Anthropic subscription',
      },
      {
        name: 'API Key',
        value: 'api-key',
        description: 'Use an Anthropic API key',
      },
    ],
  });

  if (authMode === 'subscription') {
    const profileId = await input({
      message: 'Profile ID (used in commands):',
      default: 'claude',
      validate: (value) => {
        if (!validateProfileId(value)) {
          return 'Profile ID must be alphanumeric with dashes or underscores only';
        }
        return true;
      },
    });

    const profileName = await input({
      message: 'Profile name (display name):',
      default: 'Claude (Subscription)',
    });

    return {
      profileId,
      profileName,
      config: createProfile(profileId, profileName, 'anthropic', ''),
    };
  }

  // API key mode
  const apiKey = await password({
    message: 'Enter your Anthropic API key:',
    mask: '*',
    validate: (value) => validateApiKey(value, 'anthropic'),
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'claude-api',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'Claude (API Key)',
  });

  const model = await input({
    message: 'Model (optional, press Enter for default):',
    default: '',
  });

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'anthropic', apiKey, {
      model: model || undefined,
    }),
  };
}

/**
 * Configure Kimi provider.
 */
async function configureKimi(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const apiKey = await password({
    message: 'Enter your Moonshot Kimi API key:',
    mask: '*',
    validate: (value) => validateApiKey(value, 'kimi'),
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'kimi',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'Moonshot Kimi 2.5',
  });

  const baseUrl = await input({
    message: 'Base URL:',
    default: getProviderBaseUrl('kimi'),
  });

  const model = await input({
    message: 'Model:',
    default: getProviderDefaultModel('kimi') || 'kimi-for-coding',
  });

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'kimi', apiKey, {
      baseUrl,
      model,
      extraEnv: getProviderExtraEnv('kimi'),
    }),
  };
}

/**
 * Configure OpenRouter provider.
 */
async function configureOpenRouter(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const apiKey = await password({
    message: 'Enter your OpenRouter API key:',
    mask: '*',
    validate: (value) => validateApiKey(value, 'openrouter'),
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'openrouter',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'OpenRouter',
  });

  const modelChoices = [
    { name: 'Anthropic Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
    { name: 'Anthropic Claude 3 Opus', value: 'anthropic/claude-3-opus' },
    { name: 'Meta Llama 3.1 405B', value: 'meta-llama/llama-3.1-405b-instruct' },
    { name: 'Google Gemini Pro 1.5', value: 'google/gemini-pro-1.5' },
    { name: 'Custom (specify below)', value: 'custom' },
  ];

  const selectedModel = await select({
    message: 'Select model:',
    choices: modelChoices,
  });

  let model = selectedModel;
  if (selectedModel === 'custom') {
    model = await input({
      message: 'Enter model identifier:',
      validate: (value) => value.length > 0 || 'Model is required',
    });
  }

  const baseUrl = await input({
    message: 'Base URL:',
    default: getProviderBaseUrl('openrouter'),
  });

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'openrouter', apiKey, {
      baseUrl,
      model,
      extraEnv: getProviderExtraEnv('openrouter'),
    }),
  };
}

/**
 * Configure OpenAI-compatible provider.
 */
async function configureOpenAICompatible(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const baseUrl = await input({
    message: 'Enter the base URL for your API (e.g., https://api.example.com/v1):',
    validate: (value) => {
      if (!value) return 'Base URL is required';
      try {
        new URL(value);
        return true;
      } catch {
        return 'Please enter a valid URL';
      }
    },
  });

  const apiKey = await password({
    message: 'Enter your API key:',
    mask: '*',
    validate: (value) => value.length > 0 || 'API key is required',
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'custom',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'Custom API',
  });

  const model = await input({
    message: 'Model (optional):',
    default: '',
  });

  const extraEnvInput = await input({
    message: 'Extra environment variables (KEY=value,KEY2=value2) - optional:',
    default: '',
  });

  // Parse extra env vars
  const extraEnv: Record<string, string> = {};
  if (extraEnvInput) {
    for (const pair of extraEnvInput.split(',')) {
      const [key, ...valueParts] = pair.trim().split('=');
      if (key && valueParts.length > 0) {
        extraEnv[key] = valueParts.join('=');
      }
    }
  }

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'openai-compatible', apiKey, {
      baseUrl,
      model: model || undefined,
      extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
    }),
  };
}

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
        const existingProfile = config.profiles?.find((p) => p.id === result.profileId);
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
