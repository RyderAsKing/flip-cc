import { input, password } from '@inquirer/prompts';
import { validateApiKey } from '../../lib/validate.js';
import {
  createProfile,
  validateProfileId,
  getProviderBaseUrl,
  getProviderDefaultModel,
  getProviderExtraEnv,
} from '../../lib/profiles.js';

/**
 * Configure Kimi provider.
 */
export async function configureKimi(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
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
