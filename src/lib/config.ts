import { existsSync, copyFileSync } from 'fs';
import Conf from 'conf';
import type { AppConfig, Profile } from '../types.js';

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
  profiles: {
    type: 'array',
  },
  defaultProfile: {
    type: 'string',
  },
} as const;

const config = new Conf<AppConfig>({
  projectName: 'flip-cc',
  schema,
  defaults: {
    claudeAuthMode: 'subscription',
    setupComplete: false,
    profiles: [],
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

/**
 * Backup the current config file before migration.
 */
function backupConfig(): void {
  const configPath = config.path;
  const backupPath = `${configPath}.backup`;
  try {
    if (existsSync(configPath)) {
      copyFileSync(configPath, backupPath);
    }
  } catch (err) {
    console.warn(`Warning: Failed to backup config before migration: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Migrate legacy config format to profile-based config.
 * This should be called on first run after upgrade.
 */
export async function migrateToProfiles(): Promise<boolean> {
  const currentConfig = config.store;

  // Check if already migrated
  if (currentConfig.profiles && currentConfig.profiles.length > 0) {
    return false;
  }

  const profiles: Profile[] = [];

  // Migrate Claude subscription mode
  if (currentConfig.claudeAuthMode === 'subscription') {
    profiles.push({
      id: 'claude',
      name: 'Claude (Subscription)',
      provider: 'anthropic',
      apiKey: '',
    });
  }

  // Migrate Claude API key mode
  if (currentConfig.claudeAuthMode === 'api-key' && currentConfig.anthropicApiKey) {
    profiles.push({
      id: 'claude-api',
      name: 'Claude (API Key)',
      provider: 'anthropic',
      apiKey: currentConfig.anthropicApiKey,
    });
  }

  // Migrate Kimi
  if (currentConfig.kimiApiKey) {
    profiles.push({
      id: 'kimi',
      name: 'Moonshot Kimi 2.5',
      provider: 'kimi',
      apiKey: currentConfig.kimiApiKey,
      baseUrl: 'https://api.kimi.com/coding/',
      model: 'kimi-for-coding',
      extraEnv: { ENABLE_TOOL_SEARCH: 'false' },
    });
  }

  // If no profiles were created, create default Claude profile
  if (profiles.length === 0) {
    profiles.push({
      id: 'claude',
      name: 'Claude (Subscription)',
      provider: 'anthropic',
      apiKey: '',
    });
  }

  // Backup before migration
  backupConfig();

  // Save migrated profiles
  setConfig({
    profiles,
    defaultProfile: profiles[0]?.id,
  });

  return true;
}

/**
 * Check if migration is needed.
 */
export function needsMigration(): boolean {
  const currentConfig = config.store;
  return !currentConfig.profiles || currentConfig.profiles.length === 0;
}
