import { input, password, select, confirm, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Profile, ProviderType } from '../types.js';
import {
  getProfiles,
  getProfile,
  addProfile,
  updateProfile,
  removeProfile,
  setDefaultProfile,
  validateProfileId,
  createProfile,
} from '../lib/profiles.js';
import { validateApiKey } from '../lib/validate.js';

/**
 * Mask an API key for display (show only last 4 characters).
 */
function maskApiKey(key: string): string {
  if (!key || key.length === 0) return chalk.gray('(none)');
  if (key.length <= 4) return '****';
  return chalk.gray('****') + key.slice(-4);
}

/**
 * Get provider display name.
 */
function getProviderDisplay(provider: ProviderType): string {
  switch (provider) {
    case 'anthropic':
      return chalk.blue('Anthropic');
    case 'kimi':
      return chalk.magenta('Moonshot Kimi');
    case 'openrouter':
      return chalk.green('OpenRouter');
    case 'openai-compatible':
      return chalk.yellow('OpenAI-compatible');
    default:
      return provider;
  }
}

/**
 * List all profiles.
 */
export async function profileListCommand(): Promise<void> {
  const profiles = getProfiles();

  if (profiles.length === 0) {
    console.log(chalk.yellow('No profiles configured.'));
    console.log(chalk.dim('Run "flip-cc profile add" to create your first profile.'));
    return;
  }

  const defaultProfileId = getDefaultProfile()?.id;

  console.log();
  console.log(chalk.bold('Profiles:'));
  console.log();

  for (const profile of profiles) {
    const isDefault = profile.id === defaultProfileId;
    const defaultMarker = isDefault ? chalk.green(' [default]') : '';

    console.log(`  ${chalk.cyan(profile.id)}${defaultMarker}`);
    console.log(`    Name: ${profile.name}`);
    console.log(`    Provider: ${getProviderDisplay(profile.provider)}`);
    if (profile.model) {
      console.log(`    Model: ${chalk.gray(profile.model)}`);
    }
    if (profile.baseUrl) {
      console.log(`    Base URL: ${chalk.gray(profile.baseUrl)}`);
    }
    console.log(`    API Key: ${maskApiKey(profile.apiKey)}`);
    if (profile.description) {
      console.log(`    Description: ${chalk.gray(profile.description)}`);
    }
    console.log();
  }

  console.log(chalk.dim(`Total: ${profiles.length} profile${profiles.length === 1 ? '' : 's'}`));
}

/**
 * Add a new profile interactively.
 */
export async function profileAddCommand(): Promise<void> {
  console.log();
  console.log(chalk.blue('📝 Create New Profile\n'));

  // Select provider type
  const provider = await select<ProviderType>({
    message: 'Select provider type:',
    choices: [
      {
        name: 'Anthropic (Claude)',
        value: 'anthropic',
        description: 'Official Anthropic Claude API or subscription',
      },
      {
        name: 'Moonshot Kimi',
        value: 'kimi',
        description: 'Moonshot Kimi 2.5 API',
      },
      {
        name: 'OpenRouter',
        value: 'openrouter',
        description: 'Access multiple models through OpenRouter',
      },
      {
        name: 'OpenAI-compatible',
        value: 'openai-compatible',
        description: 'Custom OpenAI-compatible endpoint',
      },
    ],
  });

  // Profile ID
  const id = await input({
    message: 'Profile ID (unique identifier):',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Profile ID is required';
      }
      if (!validateProfileId(value)) {
        return 'Profile ID can only contain letters, numbers, dashes, and underscores';
      }
      if (getProfile(value)) {
        return `Profile "${value}" already exists`;
      }
      return true;
    },
  });

  // Display name
  const name = await input({
    message: 'Display name:',
    default: id,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Display name is required';
      }
      return true;
    },
  });

  let apiKey = '';
  let baseUrl: string | undefined;
  let model: string | undefined;
  let extraEnv: Record<string, string> | undefined;

  // Provider-specific configuration
  if (provider === 'anthropic') {
    const authMode = await select<'subscription' | 'api-key'>({
      message: 'Authentication mode:',
      choices: [
        { name: 'Subscription (claude.ai)', value: 'subscription' },
        { name: 'API Key', value: 'api-key' },
      ],
    });

    if (authMode === 'api-key') {
      apiKey = await password({
        message: 'Enter your Anthropic API key:',
        mask: '*',
        validate: (value) => validateApiKey(value, 'anthropic'),
      });
    }
  } else {
    // All other providers require API key
    apiKey = await password({
      message: `Enter your ${provider === 'kimi' ? 'Kimi' : provider === 'openrouter' ? 'OpenRouter' : 'API'} key:`,
      mask: '*',
      validate: (value) => validateApiKey(value, provider),
    });
  }

  // Base URL (for custom endpoints)
  if (provider === 'openai-compatible') {
    baseUrl = await input({
      message: 'Base URL (e.g., https://api.example.com/v1):',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Base URL is required for OpenAI-compatible providers';
        }
        if (!value.startsWith('http')) {
          return 'Base URL must start with http:// or https://';
        }
        return true;
      },
    });
  }

  // Model selection
  if (provider === 'openrouter') {
    const modelChoice = await select<'claude-sonnet' | 'claude-opus' | 'gpt-4' | 'custom'>({
      message: 'Select model:',
      choices: [
        { name: 'Claude 3.5 Sonnet', value: 'claude-sonnet' },
        { name: 'Claude 3 Opus', value: 'claude-opus' },
        { name: 'GPT-4', value: 'gpt-4' },
        { name: 'Custom (enter manually)', value: 'custom' },
      ],
    });

    if (modelChoice === 'claude-sonnet') {
      model = 'anthropic/claude-3.5-sonnet';
    } else if (modelChoice === 'claude-opus') {
      model = 'anthropic/claude-3-opus';
    } else if (modelChoice === 'gpt-4') {
      model = 'openai/gpt-4';
    } else {
      model = await input({
        message: 'Enter model identifier (e.g., anthropic/claude-3-haiku):',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Model identifier is required';
          }
          return true;
        },
      });
    }
  } else if (provider === 'openai-compatible') {
    model = await input({
      message: 'Model identifier (optional):',
    });
    if (!model || model.trim().length === 0) {
      model = undefined;
    }
  }

  // Extra environment variables
  const addExtraEnv = await confirm({
    message: 'Add extra environment variables?',
    default: false,
  });

  if (addExtraEnv) {
    extraEnv = {};
    let addMore = true;
    while (addMore) {
      const envKey = await input({
        message: 'Environment variable name:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Variable name is required';
          }
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
            return 'Invalid environment variable name';
          }
          return true;
        },
      });
      const envValue = await input({
        message: `Value for ${envKey}:`,
      });
      extraEnv[envKey] = envValue;

      addMore = await confirm({
        message: 'Add another environment variable?',
        default: false,
      });
    }
  }

  // Description
  const description = await input({
    message: 'Description (optional):',
  });

  // Create and save profile
  const profile = createProfile(id, name, provider, apiKey, {
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    extraEnv: extraEnv || undefined,
    description: description || undefined,
  });

  addProfile(profile);

  console.log();
  console.log(chalk.green(`✓ Profile "${id}" created successfully!`));
  console.log();
  console.log(chalk.dim('Use with:'), chalk.cyan(`flip-cc launch ${id}`));
}

/**
 * Edit an existing profile.
 */
export async function profileEditCommand(id?: string): Promise<void> {
  // If no ID provided, show selector
  let profileId = id;
  if (!profileId) {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles to edit. Run "flip-cc profile add" first.'));
      return;
    }

    profileId = await select({
      message: 'Select profile to edit:',
      choices: profiles.map((p) => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
      })),
    });
  }

  const profile = getProfile(profileId);
  if (!profile) {
    console.error(chalk.red(`Error: Profile "${profileId}" not found.`));
    console.log(chalk.yellow('Run "flip-cc profile list" to see available profiles.'));
    process.exit(1);
  }

  console.log();
  console.log(chalk.blue(`📝 Editing Profile: ${profile.id}\n`));

  // Edit display name
  const name = await input({
    message: 'Display name:',
    default: profile.name,
  });

  // Edit API key (optional - leave blank to keep current)
  const currentKeyHint = profile.apiKey ? maskApiKey(profile.apiKey) : chalk.gray('(none)');
  const newApiKey = await password({
    message: `API key (current: ${currentKeyHint}, leave blank to keep):`,
    mask: '*',
  });

  let apiKey = profile.apiKey;
  if (newApiKey && newApiKey.trim().length > 0) {
    const validation = validateApiKey(newApiKey, profile.provider);
    if (validation !== true) {
      console.error(chalk.red(`Error: ${validation}`));
      process.exit(1);
    }
    apiKey = newApiKey;
  } else if (newApiKey === '' && profile.provider === 'anthropic') {
    // Allow clearing API key for Anthropic (subscription mode)
    const clearKey = await confirm({
      message: 'Remove API key and use subscription mode?',
      default: false,
    });
    if (clearKey) {
      apiKey = '';
    }
  }

  // Edit base URL
  let baseUrl = profile.baseUrl;
  const editBaseUrl = await confirm({
    message: 'Edit base URL?',
    default: false,
  });
  if (editBaseUrl) {
    const newBaseUrl = await input({
      message: 'Base URL (leave blank for default):',
      default: baseUrl || '',
    });
    baseUrl = newBaseUrl || undefined;
  }

  // Edit model
  let model = profile.model;
  const editModel = await confirm({
    message: 'Edit model?',
    default: false,
  });
  if (editModel) {
    const newModel = await input({
      message: 'Model identifier (leave blank for default):',
      default: model || '',
    });
    model = newModel || undefined;
  }

  // Edit description
  const description = await input({
    message: 'Description:',
    default: profile.description || '',
  });

  // Update profile
  updateProfile(profileId, {
    name: name.trim() || profile.name,
    apiKey,
    baseUrl,
    model,
    description: description || undefined,
  });

  console.log();
  console.log(chalk.green(`✓ Profile "${profileId}" updated successfully!`));
}

/**
 * Remove a profile.
 */
export async function profileRemoveCommand(id?: string): Promise<void> {
  // If no ID provided, show selector
  let profileId = id;
  if (!profileId) {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles to remove.'));
      return;
    }

    profileId = await select({
      message: 'Select profile to remove:',
      choices: profiles.map((p) => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
      })),
    });
  }

  const profile = getProfile(profileId);
  if (!profile) {
    console.error(chalk.red(`Error: Profile "${profileId}" not found.`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.yellow(`You are about to remove profile: ${chalk.bold(profile.name)} (${profileId})`));

  const confirmRemove = await confirm({
    message: 'Are you sure?',
    default: false,
  });

  if (!confirmRemove) {
    console.log(chalk.yellow('Removal cancelled.'));
    return;
  }

  removeProfile(profileId);

  console.log();
  console.log(chalk.green(`✓ Profile "${profileId}" removed successfully.`));
}

/**
 * Set the default profile.
 */
export async function profileSetDefaultCommand(id?: string): Promise<void> {
  // If no ID provided, show selector
  let profileId = id;
  if (!profileId) {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured. Run "flip-cc profile add" first.'));
      return;
    }

    profileId = await select({
      message: 'Select default profile:',
      choices: profiles.map((p) => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
        description: p.description,
      })),
    });
  }

  if (!getProfile(profileId)) {
    console.error(chalk.red(`Error: Profile "${profileId}" not found.`));
    process.exit(1);
  }

  setDefaultProfile(profileId);

  console.log();
  console.log(chalk.green(`✓ Default profile set to "${profileId}"`));
  console.log();
  console.log(chalk.dim('This profile will be used when running'), chalk.cyan('flip-cc launch'), chalk.dim('without specifying a profile.'));
}

// Helper to get default profile
function getDefaultProfile(): Profile | undefined {
  const profiles = getProfiles();
  const config = { defaultProfile: undefined as string | undefined };

  // Import at function level to avoid circular dependency
  const { getConfig } = require('../lib/config.js');
  const fullConfig = getConfig();
  config.defaultProfile = fullConfig.defaultProfile;

  if (config.defaultProfile) {
    return profiles.find((p) => p.id === config.defaultProfile);
  }
  return profiles[0];
}
