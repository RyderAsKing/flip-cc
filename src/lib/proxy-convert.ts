/**
 * Pure Anthropic↔OpenAI conversion functions.
 * No I/O — fully unit-testable.
 */

// ── Anthropic request types ──────────────────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: { user_id?: string };
}

// ── OpenAI request types ─────────────────────────────────────────────────────

interface OpenAITextContent {
  type: 'text';
  text: string;
}

interface OpenAIImageContent {
  type: 'image_url';
  image_url: { url: string };
}

type OpenAIContent = string | (OpenAITextContent | OpenAIImageContent)[];

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: OpenAIContent;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  user?: string;
}

// ── OpenAI response types ────────────────────────────────────────────────────

interface OpenAIResponseMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIChoice {
  index: number;
  message: OpenAIResponseMessage;
  finish_reason: string | null;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// ── Anthropic response types ─────────────────────────────────────────────────

interface AnthropicResponseTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponseToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicResponseBlock = AnthropicResponseTextBlock | AnthropicResponseToolUseBlock;

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicResponseBlock[];
  stop_reason: string;
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ── Streaming types ──────────────────────────────────────────────────────────

interface OpenAIStreamDelta {
  role?: string;
  content?: string;
  tool_calls?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: string | null;
}

interface OpenAIStreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIStreamUsage;
}

export type AnthropicEventType =
  | 'message_start'
  | 'content_block_start'
  | 'ping'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'error';

export interface AnthropicEvent {
  event: AnthropicEventType;
  data: unknown;
}

export interface StreamState {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  currentBlockIndex: number;
  currentBlockType: 'text' | 'tool_use' | null;
  toolCallAccumulator: Map<number, { id: string; name: string; argumentsJson: string }>;
  headersSent: boolean;
}

// ── Helper: convert Anthropic content block to OpenAI content ────────────────

function convertContentToOpenAI(
  content: string | AnthropicContentBlock[]
): OpenAIContent {
  if (typeof content === 'string') {
    return content;
  }

  const textParts = content.filter((b): b is AnthropicTextBlock => b.type === 'text');
  const imageParts = content.filter((b): b is AnthropicImageBlock => b.type === 'image');

  if (imageParts.length === 0) {
    // Plain text only — join and return string
    return textParts.map((b) => b.text).join('');
  }

  // Mixed content — return array
  const result: (OpenAITextContent | OpenAIImageContent)[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      result.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      result.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    }
  }
  return result;
}

// ── Helper: map finish_reason to stop_reason ─────────────────────────────────

function finishReasonToStopReason(reason: string | null): string {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

// ── anthropicToOpenAI ────────────────────────────────────────────────────────

/**
 * Convert an Anthropic Messages API request to an OpenAI Chat Completions request.
 */
export function anthropicToOpenAI(req: AnthropicRequest, profileModel?: string): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  // System prompt → system message
  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  // Convert messages
  for (const msg of req.messages) {
    if (typeof msg.content === 'string' || !Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: msg.content as string });
      continue;
    }

    // Check for tool_result blocks (must become separate tool messages)
    const toolResults = msg.content.filter(
      (b): b is AnthropicToolResultBlock => b.type === 'tool_result'
    );

    if (toolResults.length > 0) {
      // Each tool_result → a separate "tool" role message
      for (const tr of toolResults) {
        const toolContent =
          typeof tr.content === 'string'
            ? tr.content
            : tr.content.map((b) => b.text).join('');
        messages.push({
          role: 'tool',
          content: toolContent,
          tool_call_id: tr.tool_use_id,
        });
      }

      // Any non-tool_result content in the same message
      const otherBlocks = msg.content.filter((b) => b.type !== 'tool_result');
      if (otherBlocks.length > 0) {
        messages.push({
          role: msg.role,
          content: convertContentToOpenAI(otherBlocks as AnthropicContentBlock[]),
        });
      }
      continue;
    }

    // Check for tool_use blocks in assistant messages
    const toolUseBlocks = msg.content.filter(
      (b): b is AnthropicToolUseBlock => b.type === 'tool_use'
    );

    if (toolUseBlocks.length > 0 && msg.role === 'assistant') {
      const textBlocks = msg.content.filter(
        (b): b is AnthropicTextBlock => b.type === 'text'
      );
      const textContent = textBlocks.map((b) => b.text).join('') || null;

      messages.push({
        role: 'assistant',
        content: textContent ?? '',
        tool_calls: toolUseBlocks.map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        })),
      });
      continue;
    }

    messages.push({
      role: msg.role,
      content: convertContentToOpenAI(msg.content),
    });
  }

  // Tools
  let tools: OpenAITool[] | undefined;
  if (req.tools && req.tools.length > 0) {
    tools = req.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  // Tool choice
  let tool_choice: OpenAIToolChoice | undefined;
  if (req.tool_choice) {
    if (req.tool_choice.type === 'auto') {
      tool_choice = 'auto';
    } else if (req.tool_choice.type === 'any') {
      tool_choice = 'required';
    } else if (req.tool_choice.type === 'tool') {
      tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
    }
  }

  const result: OpenAIRequest = {
    model: profileModel || req.model,
    messages,
    stream: req.stream,
  };

  // Handle max_tokens vs max_completion_tokens
  // OpenAI o1, o3, and GPT-5.1 series use max_completion_tokens
  if (req.max_tokens !== undefined) {
    if (needsMaxCompletionTokens(profileModel || req.model)) {
      result.max_completion_tokens = req.max_tokens;
    } else {
      result.max_tokens = req.max_tokens;
    }
  }

  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stop_sequences && req.stop_sequences.length > 0) result.stop = req.stop_sequences;
  if (req.metadata?.user_id) result.user = req.metadata.user_id;
  if (tools) result.tools = tools;
  if (tool_choice !== undefined) result.tool_choice = tool_choice;
  // top_k is silently dropped

  return result;
}

/**
 * Check if a model requires max_completion_tokens instead of max_tokens.
 * OpenAI's newer reasoning models (o1, o3) and GPT-5 series use this parameter.
 */
function needsMaxCompletionTokens(model: string): boolean {
  const modelLower = model.toLowerCase();
  // o1 and o3 series reasoning models
  if (modelLower.startsWith('o1') || modelLower.startsWith('o3')) {
    return true;
  }
  // GPT-5 series (gpt-5, gpt-5.1, gpt-5-mini, gpt-5-codex, etc.)
  if (modelLower.includes('gpt-5')) {
    return true;
  }
  return false;
}

// ── openAIToAnthropic ────────────────────────────────────────────────────────

/**
 * Convert an OpenAI Chat Completions response to an Anthropic Messages response.
 */
export function openAIToAnthropic(res: OpenAIResponse, requestedModel: string): AnthropicResponse {
  const choice = res.choices[0];
  const content: AnthropicResponseBlock[] = [];

  if (choice?.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  if (choice?.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        console.warn(`[flip-cc proxy] Failed to parse tool call arguments for "${tc.function.name}", using empty object`);
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  return {
    id: res.id.startsWith('msg_') ? res.id : `msg_${res.id}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: finishReasonToStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

// ── openAIStreamChunkToAnthropic ─────────────────────────────────────────────

export function createStreamState(messageId: string, model: string): StreamState {
  return {
    messageId,
    model,
    inputTokens: 0,
    outputTokens: 0,
    currentBlockIndex: -1,
    currentBlockType: null,
    toolCallAccumulator: new Map(),
    headersSent: false,
  };
}

/**
 * Convert a single OpenAI stream chunk to zero or more Anthropic SSE events.
 * Mutates `state` to track streaming position.
 */
export function openAIStreamChunkToAnthropic(
  chunk: OpenAIStreamChunk,
  state: StreamState
): AnthropicEvent[] {
  const events: AnthropicEvent[] = [];
  const choice = chunk.choices[0];

  // Update usage from chunk if present
  if (chunk.usage) {
    if (chunk.usage.prompt_tokens) state.inputTokens = chunk.usage.prompt_tokens;
    if (chunk.usage.completion_tokens) state.outputTokens = chunk.usage.completion_tokens;
  }

  // First chunk — emit preamble
  if (!state.headersSent) {
    state.headersSent = true;
    state.messageId = chunk.id || state.messageId;
    state.model = chunk.model || state.model;

    events.push({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: state.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: state.inputTokens, output_tokens: 0 },
        },
      },
    });

    // Open initial text block
    state.currentBlockIndex = 0;
    state.currentBlockType = 'text';
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    });

    events.push({ event: 'ping', data: { type: 'ping' } });
  }

  if (!choice) return events;

  const delta = choice.delta;

  // Text delta
  if (delta.content) {
    // If current block is tool_use, close it and open a text block
    if (state.currentBlockType === 'tool_use') {
      events.push({
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: state.currentBlockIndex },
      });
      state.currentBlockIndex++;
      state.currentBlockType = 'text';
      events.push({
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: state.currentBlockIndex,
          content_block: { type: 'text', text: '' },
        },
      });
    }

    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: state.currentBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      },
    });
  }

  // Tool call deltas
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;

      if (tc.id) {
        // New tool call — close current block and open tool_use block
        if (state.currentBlockType !== null) {
          events.push({
            event: 'content_block_stop',
            data: { type: 'content_block_stop', index: state.currentBlockIndex },
          });
          state.currentBlockIndex++;
        }
        state.currentBlockType = 'tool_use';
        state.toolCallAccumulator.set(idx, {
          id: tc.id,
          name: tc.function?.name || '',
          argumentsJson: '',
        });

        events.push({
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: state.currentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id,
              name: tc.function?.name || '',
              input: {},
            },
          },
        });
      }

      // Arguments fragment
      if (tc.function?.arguments) {
        const acc = state.toolCallAccumulator.get(idx);
        if (acc) {
          acc.argumentsJson += tc.function.arguments;
        }
        events.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: state.currentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          },
        });
      }
    }
  }

  // finish_reason — close everything
  if (choice.finish_reason) {
    if (state.currentBlockType !== null) {
      events.push({
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: state.currentBlockIndex },
      });
      state.currentBlockType = null;
    }

    events.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: {
          stop_reason: finishReasonToStopReason(choice.finish_reason),
          stop_sequence: null,
        },
        usage: { output_tokens: state.outputTokens },
      },
    });

    events.push({
      event: 'message_stop',
      data: { type: 'message_stop' },
    });
  }

  return events;
}
