import type { AppConfig, LaunchTarget, Profile, ProviderType } from '../types.js';
import { getProfile, getDefaultProfileId } from './profiles.js';

/**
 * Validates an API key format.
 * @param key - The API key to validate
 * @param type - The type of API key ('anthropic', 'kimi', 'openrouter', or 'openai-compatible')
 * @returns Error string if invalid, true if valid
 */
export function validateApiKey(key: string, type: ProviderType): string | true {
  if (!key || key.trim().length === 0) {
    return 'API key cannot be empty';
  }

  if (type === 'anthropic') {
    // Anthropic keys start with 'sk-ant' (e.g., 'sk-ant-', 'sk-ant-api03-')
    if (!key.startsWith('sk-ant')) {
      return 'Anthropic API key must start with "sk-ant"';
    }
  } else if (type === 'kimi') {
    // Kimi keys: non-empty with minimum length (at least 10 chars)
    if (key.length < 10) {
      return 'Kimi API key seems too short (minimum 10 characters)';
    }
  } else if (type === 'openrouter') {
    // OpenRouter keys start with 'sk-or-v1-'
    if (!key.startsWith('sk-or-v1-')) {
      return 'OpenRouter API key must start with "sk-or-v1-"';
    }
  } else if (type === 'openai-compatible') {
    // Generic OpenAI-compatible: just check minimum length
    if (key.length < 10) {
      return 'API key seems too short (minimum 10 characters)';
    }
  }

  return true;
}

/**
 * Validate a profile is ready to use (has required fields, valid API key if needed).
 * @param profile - The profile to validate
 * @returns Error string if invalid, true if valid
 */
export function validateProfile(profile: Profile): string | true {
  if (!profile.id || profile.id.trim().length === 0) {
    return 'Profile ID is required';
  }

  if (!profile.name || profile.name.trim().length === 0) {
    return 'Profile name is required';
  }

  // Subscription-based anthropic profiles don't need API key
  if (profile.provider === 'anthropic' && !profile.apiKey) {
    return true;
  }

  // All other providers need an API key
  if (!profile.apiKey || profile.apiKey.trim().length === 0) {
    return `API key is required for ${profile.provider} provider`;
  }

  const keyValidation = validateApiKey(profile.apiKey, profile.provider);
  if (keyValidation !== true) {
    return keyValidation;
  }

  return true;
}

/**
 * Checks if the configuration is complete for launching a target.
 * @param config - The app configuration
 * @param target - The launch target
 * @returns Error string if incomplete, true if complete
 * @deprecated Use validateProfileReady instead
 */
export function validateSetupComplete(
  config: AppConfig,
  target: LaunchTarget,
  useApiKey?: boolean
): string | true {
  if (!config.setupComplete) {
    return 'Setup not complete. Run "flip-cc setup" first.';
  }

  if (target === 'kimi') {
    if (!config.kimiApiKey) {
      return 'Kimi API key not configured. Run "flip-cc setup" to configure it.';
    }
  } else if (target === 'claude' && useApiKey) {
    if (config.claudeAuthMode !== 'api-key' || !config.anthropicApiKey) {
      return 'Anthropic API key not configured. Run "flip-cc setup" to configure it.';
    }
  }

  return true;
}

/**
 * Checks if a profile is ready to launch.
 * @param profileId - The profile ID to validate
 * @returns Error string if incomplete, true if ready
 */
export function validateProfileReady(profileId: string): string | true {
  const profile = getProfile(profileId);
  if (!profile) {
    return `Profile "${profileId}" not found. Run "flip-cc profile list" to see available profiles.`;
  }

  const validation = validateProfile(profile);
  if (validation !== true) {
    return `Profile "${profileId}" is invalid: ${validation}`;
  }

  return true;
}

/**
 * Checks if setup is complete for profile-based system.
 * @param config - The app configuration
 * @returns Error string if incomplete, true if complete
 */
export function validateProfilesSetup(config: AppConfig): string | true {
  if (!config.profiles || config.profiles.length === 0) {
    return 'No profiles configured. Run "flip-cc setup" to create your first profile.';
  }

  const defaultId = getDefaultProfileId();
  if (!defaultId) {
    return 'No default profile set. Run "flip-cc profile set-default <id>" to set one.';
  }

  return true;
}
