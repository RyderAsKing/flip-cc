import chalk from 'chalk';
import type { ProviderType } from '../types.js';

export const MINIMAX_MODELS = [
  { value: 'MiniMax-M2.5', name: 'MiniMax M2.5' },
  { value: 'MiniMax-M2.7', name: 'MiniMax M2.7 (latest)' },
];

/**
 * Returns all Claude Code model env vars pointing to the same model.
 * Use this whenever overriding the model for a non-Anthropic provider so that
 * both the main model and the background "small/fast" model are redirected —
 * otherwise Claude Code falls back to its built-in Haiku/Sonnet defaults for
 * sub-tasks even when ANTHROPIC_MODEL is set.
 */
export function getAllModelEnvs(model: string): Record<string, string> {
  return {
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  };
}

/** @deprecated Use getAllModelEnvs instead */
export function getMinimaxModelEnv(model: string): Record<string, string> {
  return getAllModelEnvs(model);
}

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
    defaultBaseUrl: 'https://openrouter.ai/api',
    defaultModel: undefined,
    apiKeyEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    requiresModel: false,
    requiresBaseUrl: false,
    extraEnv: {},
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
    },
  },
} as const;

/**
 * Get provider definition by type.
 */
export function getProvider(type: ProviderType): ProviderDefinition {
  return PROVIDERS[type];
}
