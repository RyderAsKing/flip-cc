import { input, password, select } from '@inquirer/prompts';
import { validateApiKey } from '../../lib/validate.js';
import { createProfile, validateProfileId } from '../../lib/profiles.js';
import type { AuthMode } from '../../types.js';

/**
 * Configure Anthropic provider - supports both subscription and API key modes.
 */
export async function configureAnthropic(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
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
