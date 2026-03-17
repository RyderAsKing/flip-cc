import chalk from 'chalk';
import type { ProviderType } from '../types.js';

export interface ProviderDefinition {
  name: string;
  displayName: string;
  color: (text: string) => string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  apiKeyEnvVar?: string;
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
  minimax: {
    name: 'MiniMax',
    displayName: 'MiniMax',
    color: chalk.yellow,
    defaultBaseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'MiniMax-M2.5',
    apiKeyEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    requiresModel: false,
    requiresBaseUrl: false,
    extraEnv: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ANTHROPIC_SMALL_FAST_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.5',
    },
  },
} as const;

/**
 * Get provider definition by type.
 */
export function getProvider(type: ProviderType): ProviderDefinition {
  return PROVIDERS[type];
}
