import Conf from 'conf';
import type { AppConfig } from '../types.js';

const schema = {
  claudeAuthMode: {
    type: 'string',
    enum: ['subscription', 'api-key'],
  },
  anthropicApiKey: {
    type: 'string',
  },
  kimiApiKey: {
    type: 'string',
  },
  setupComplete: {
    type: 'boolean',
  },
} as const;

const config = new Conf<AppConfig>({
  projectName: 'flip-cc',
  schema,
  defaults: {
    claudeAuthMode: 'subscription',
    setupComplete: false,
  },
});

/**
 * Get the full configuration object.
 */
export function getConfig(): AppConfig {
  return config.store;
}

/**
 * Merge partial config into existing config.
 */
export function setConfig(patch: Partial<AppConfig>): void {
  const current = config.store;
  config.set({ ...current, ...patch });
}

/**
 * Check if setup has been completed.
 */
export function isSetupComplete(): boolean {
  return config.get('setupComplete');
}

/**
 * Clear all configuration (for reset/testing).
 */
export function clearConfig(): void {
  config.clear();
}

/**
 * Get the config file path (useful for debugging).
 */
export function getConfigPath(): string {
  return config.path;
}
