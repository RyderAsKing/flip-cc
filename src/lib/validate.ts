import type { AppConfig, LaunchTarget } from '../types.js';

/**
 * Validates an API key format.
 * @param key - The API key to validate
 * @param type - The type of API key ('anthropic' or 'kimi')
 * @returns Error string if invalid, true if valid
 */
export function validateApiKey(key: string, type: 'anthropic' | 'kimi'): string | true {
  if (!key || key.trim().length === 0) {
    return 'API key cannot be empty';
  }

  if (type === 'anthropic') {
    // Anthropic keys start with 'sk-ant-'
    if (!key.startsWith('sk-ant-')) {
      return 'Anthropic API key must start with "sk-ant-"';
    }
  } else if (type === 'kimi') {
    // Kimi keys: non-empty with minimum length (at least 10 chars)
    if (key.length < 10) {
      return 'Kimi API key seems too short (minimum 10 characters)';
    }
  }

  return true;
}

/**
 * Checks if the configuration is complete for launching a target.
 * @param config - The app configuration
 * @param target - The launch target
 * @returns Error string if incomplete, true if complete
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
