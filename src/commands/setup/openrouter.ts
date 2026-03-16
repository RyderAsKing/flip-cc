import { input, password, select } from '@inquirer/prompts';
import { validateApiKey } from '../../lib/validate.js';
import {
  createProfile,
  validateProfileId,
  getProviderBaseUrl,
  getProviderExtraEnv,
} from '../../lib/profiles.js';

/**
 * Configure OpenRouter provider.
 */
export async function configureOpenRouter(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
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
