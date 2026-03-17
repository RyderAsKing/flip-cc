import { input, password, select } from '@inquirer/prompts';
import { validateApiKey } from '../../lib/validate.js';
import {
  createProfile,
  validateProfileId,
  getProviderExtraEnv,
} from '../../lib/profiles.js';

const MINIMAX_REGIONS = [
  { value: 'https://api.minimax.io/anthropic', name: 'International (api.minimax.io)' },
  { value: 'https://api.minimaxi.com/anthropic', name: 'China (api.minimaxi.com)' },
];

/**
 * Configure MiniMax provider.
 */
export async function configureMinimax(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const baseUrl = await select<string>({
    message: 'Select your MiniMax region:',
    choices: MINIMAX_REGIONS,
  });

  const apiKey = await password({
    message: 'Enter your MiniMax API key:',
    mask: '*',
    validate: (value) => validateApiKey(value, 'minimax'),
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'minimax',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'MiniMax M2.5',
  });

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'minimax', apiKey, {
      baseUrl,
      extraEnv: getProviderExtraEnv('minimax'),
    }),
  };
}
