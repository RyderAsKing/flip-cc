import chalk from 'chalk';
import type { ProviderType } from '../types.js';

export interface ProviderDefinition {
  name: string;
  displayName: string;
  color: (text: string) => string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  requiresModel: boolean;
  requiresBaseUrl: boolean;
  extraEnv: Record<string, string>;
}

export const PROVIDERS: Record<ProviderType, ProviderDefinition> = {
  anthropic: {
    name: 'Anthropic',
    displayName: 'Anthropic',
    color: chalk.blue,
    defaultBaseUrl: undefined,
    defaultModel: undefined,
    requiresModel: false,
    requiresBaseUrl: false,
    extraEnv: {},
  },
  kimi: {
    name: 'Kimi',
    displayName: 'Moonshot Kimi',
    color: chalk.magenta,
    defaultBaseUrl: 'https://api.kimi.com/coding/',
    defaultModel: 'kimi-for-coding',
    requiresModel: false,
    requiresBaseUrl: false,
    extraEnv: { ENABLE_TOOL_SEARCH: 'false' },
  },
  openrouter: {
    name: 'OpenRouter',
    displayName: 'OpenRouter',
    color: chalk.green,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: undefined,
    requiresModel: false,
    requiresBaseUrl: false,
    extraEnv: {
      HTTP_REFERER: 'https://github.com/flip-cc',
      X_TITLE: 'flip-cc',
    },
  },
  'openai-compatible': {
    name: 'OpenAI-Compatible',
    displayName: 'OpenAI-Compatible',
    color: chalk.cyan,
    defaultBaseUrl: undefined,
    defaultModel: undefined,
    requiresModel: true,
    requiresBaseUrl: true,
    extraEnv: {},
  },
} as const;

/**
 * Get provider definition by type.
 */
export function getProvider(type: ProviderType): ProviderDefinition {
  return PROVIDERS[type];
}
