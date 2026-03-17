export type AuthMode = 'subscription' | 'api-key';
export type LaunchTarget = 'claude' | 'kimi';

export type ProviderType =
  | 'anthropic'
  | 'kimi'
  | 'openrouter'
  | 'openai-compatible'
  | 'minimax';

export interface Profile {
  id: string;
  name: string;
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  extraEnv?: Record<string, string>;
  description?: string;
}

export interface AppConfig {
  claudeAuthMode: AuthMode;
  anthropicApiKey?: string;
  kimiApiKey?: string;
  setupComplete: boolean;

  // New profile-based config
  profiles?: Profile[];
  defaultProfile?: string;
}

export interface SessionRecord {
  profileId: string;
  profileName: string;
  provider: ProviderType;
  startedAt: string;      // ISO 8601
  endedAt: string;        // ISO 8601
  durationMs: number;
  exitCode: number | null;
}

export interface StatsData {
  sessions: SessionRecord[];
}
