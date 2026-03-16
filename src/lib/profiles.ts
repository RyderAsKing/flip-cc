import type { Profile, ProviderType } from '../types.js';
import { getConfig, setConfig } from './config.js';
import { getProvider } from './providers.js';

/**
 * Default profile configurations for built-in providers.
 */
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'claude',
    name: 'Claude (Subscription)',
    provider: 'anthropic',
    apiKey: '',
  },
];

/**
 * Get all profiles from config.
 */
export function getProfiles(): Profile[] {
  const config = getConfig();
  return config.profiles ?? [];
}

/**
 * Get a single profile by ID.
 */
export function getProfile(id: string): Profile | undefined {
  const profiles = getProfiles();
  return profiles.find((p) => p.id === id);
}

/**
 * Check if a profile exists.
 */
export function hasProfile(id: string): boolean {
  return getProfile(id) !== undefined;
}

/**
 * Add a new profile.
 */
export function addProfile(profile: Profile): void {
  const config = getConfig();
  const profiles = config.profiles ?? [];

  if (profiles.some((p) => p.id === profile.id)) {
    throw new Error(`Profile "${profile.id}" already exists`);
  }

  profiles.push(profile);
  setConfig({ profiles });
}

/**
 * Update an existing profile.
 */
export function updateProfile(id: string, updates: Partial<Omit<Profile, 'id'>>): void {
  const config = getConfig();
  const profiles = config.profiles ?? [];

  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new Error(`Profile "${id}" not found`);
  }

  const existing = profiles[index]!;
  profiles[index] = { ...existing, ...updates, id: existing.id };
  setConfig({ profiles });
}

/**
 * Remove a profile by ID.
 */
export function removeProfile(id: string): void {
  const config = getConfig();
  const profiles = config.profiles ?? [];

  const filtered = profiles.filter((p) => p.id !== id);
  if (filtered.length === profiles.length) {
    throw new Error(`Profile "${id}" not found`);
  }

  // If removing the default profile, clear the default
  const updates: { profiles: Profile[]; defaultProfile?: string } = { profiles: filtered };
  if (config.defaultProfile === id) {
    updates.defaultProfile = undefined;
  }

  setConfig(updates);
}

/**
 * Set the default profile.
 */
export function setDefaultProfile(id: string): void {
  if (!hasProfile(id)) {
    throw new Error(`Profile "${id}" not found`);
  }
  setConfig({ defaultProfile: id });
}

/**
 * Get the default profile ID, or the first profile if none set.
 */
export function getDefaultProfileId(): string | undefined {
  const config = getConfig();
  const profiles = config.profiles ?? [];

  if (profiles.length === 0) {
    return undefined;
  }

  // Return the set default if it exists
  if (config.defaultProfile && hasProfile(config.defaultProfile)) {
    return config.defaultProfile;
  }

  // Fallback to first profile
  return profiles[0]?.id;
}

/**
 * Get the default profile object.
 */
export function getDefaultProfile(): Profile | undefined {
  const id = getDefaultProfileId();
  return id ? getProfile(id) : undefined;
}

/**
 * Validate a profile ID (alphanumeric, dashes, underscores only).
 */
export function validateProfileId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Get provider-specific base URL.
 */
export function getProviderBaseUrl(provider: ProviderType): string | undefined {
  return getProvider(provider).defaultBaseUrl;
}

/**
 * Get provider-specific default model.
 */
export function getProviderDefaultModel(provider: ProviderType): string | undefined {
  return getProvider(provider).defaultModel;
}

/**
 * Get extra environment variables for a provider.
 */
export function getProviderExtraEnv(provider: ProviderType): Record<string, string> {
  return { ...getProvider(provider).extraEnv };
}

/**
 * Create a profile from provider config.
 */
export function createProfile(
  id: string,
  name: string,
  provider: ProviderType,
  apiKey: string,
  options?: {
    baseUrl?: string;
    model?: string;
    extraEnv?: Record<string, string>;
    description?: string;
  }
): Profile {
  const baseUrl = options?.baseUrl ?? getProviderBaseUrl(provider);
  const defaultModel = options?.model ?? getProviderDefaultModel(provider);
  const providerExtraEnv = getProviderExtraEnv(provider);
  const extraEnv = { ...providerExtraEnv, ...(options?.extraEnv ?? {}) };

  return {
    id,
    name,
    provider,
    apiKey,
    ...(baseUrl && { baseUrl }),
    ...(defaultModel && { model: defaultModel }),
    ...(Object.keys(extraEnv).length > 0 && { extraEnv }),
    ...(options?.description && { description: options.description }),
  };
}

/**
 * Initialize default profiles if none exist.
 */
export function initializeDefaultProfiles(): void {
  const config = getConfig();
  if (!config.profiles || config.profiles.length === 0) {
    setConfig({ profiles: [...DEFAULT_PROFILES] });
  }
}
