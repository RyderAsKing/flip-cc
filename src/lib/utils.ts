import chalk from 'chalk';
import { tmpdir } from 'os';
import type { ProviderType } from '../types.js';
import { PROVIDERS } from './providers.js';

/**
 * Get the user's home directory with cross-platform fallbacks.
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || tmpdir();
}

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
  const def = PROVIDERS[provider as ProviderType];
  if (def) {
    return def.color(def.displayName);
  }
  return String(provider);
}
