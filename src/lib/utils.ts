import chalk from 'chalk';
import type { ProviderType } from '../types.js';

/**
 * Mask an API key for display (show first 4 + last 4 characters).
 */
export function maskApiKey(key: string): string {
  if (!key || key.length === 0) return chalk.gray('(none)');
  if (key.length <= 8) return '****';
  return chalk.gray(key.slice(0, 4) + '****' + key.slice(-4));
}

/**
 * Get provider display name with colour.
 */
export function getProviderDisplay(provider: ProviderType | string): string {
  switch (provider) {
    case 'anthropic':
      return chalk.blue('Anthropic');
    case 'kimi':
      return chalk.magenta('Moonshot Kimi');
    case 'openrouter':
      return chalk.green('OpenRouter');
    case 'openai-compatible':
      return chalk.cyan('OpenAI-Compatible');
    default:
      return String(provider);
  }
}
