import { input, password } from '@inquirer/prompts';
import { validateApiKey } from '../../lib/validate.js';
import { createProfile, validateProfileId } from '../../lib/profiles.js';

/**
 * Configure an OpenAI-compatible provider.
 */
export async function configureOpenAICompatible(): Promise<{ profileId: string; profileName: string; config: unknown } | null> {
  const apiKey = await password({
    message: 'Enter your API key:',
    mask: '*',
    validate: (value) => validateApiKey(value, 'openai-compatible'),
  });

  const baseUrl = await input({
    message: 'Base URL (e.g. https://api.groq.com/openai/v1):',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Base URL is required';
      }
      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return 'Base URL must start with http:// or https://';
      }
      try {
        new URL(value);
        return true;
      } catch {
        return 'Must be a valid URL (e.g. https://api.groq.com/openai/v1)';
      }
    },
  });

  const model = await input({
    message: 'Model name (e.g. llama-3.1-70b-versatile):',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Model name is required';
      }
      return true;
    },
  });

  const profileId = await input({
    message: 'Profile ID (used in commands):',
    default: 'openai-compat',
    validate: (value) => {
      if (!validateProfileId(value)) {
        return 'Profile ID must be alphanumeric with dashes or underscores only';
      }
      return true;
    },
  });

  const profileName = await input({
    message: 'Profile name (display name):',
    default: 'OpenAI-Compatible',
  });

  const description = await input({
    message: 'Description (optional):',
    default: '',
  });

  return {
    profileId,
    profileName,
    config: createProfile(profileId, profileName, 'openai-compatible', apiKey, {
      baseUrl,
      model,
      description: description || undefined,
    }),
  };
}
