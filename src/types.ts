export type AuthMode = 'subscription' | 'api-key';
export type LaunchTarget = 'claude' | 'kimi';

export interface AppConfig {
  claudeAuthMode: AuthMode;
  anthropicApiKey?: string;
  kimiApiKey?: string;
  setupComplete: boolean;
}
