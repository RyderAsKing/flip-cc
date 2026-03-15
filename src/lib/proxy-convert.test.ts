import { describe, it, expect } from 'bun:test';
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  openAIStreamChunkToAnthropic,
  createStreamState,
  type AnthropicRequest,
  type OpenAIResponse,
  type OpenAIStreamChunk,
} from './proxy-convert';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOpenAIResponse(overrides: Partial<OpenAIResponse> = {}): OpenAIResponse {
  return {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  };
}

function makeStreamChunk(
  id: string,
  model: string,
  delta: {
    role?: string;
    content?: string;
    tool_calls?: OpenAIStreamChunk['choices'][0]['delta']['tool_calls'];
  },
  finish_reason: string | null = null
): OpenAIStreamChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: 1700000000,
    model,
    choices: [{ index: 0, delta, finish_reason }],
  };
}

// ── anthropicToOpenAI ────────────────────────────────────────────────────────

describe('anthropicToOpenAI', () => {
  it('converts a minimal request with a string message', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = anthropicToOpenAI(req);
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('uses profileModel when provided', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = anthropicToOpenAI(req, 'gpt-4o');
    expect(result.model).toBe('gpt-4o');
  });

  it('prepends system prompt as a system message', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('omits system message when system is not set', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('converts text-only content blocks to a plain string', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' world' },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages[0].content).toBe('Hello world');
  });

  it('converts image blocks to image_url array content', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this:' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
            },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    const content = result.messages[0].content as Array<{ type: string; [k: string]: unknown }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'Describe this:' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    });
  });

  it('converts tool_use blocks in an assistant message to tool_calls', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me look that up.' },
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'get_weather',
              input: { city: 'Paris' },
            },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    const msg = result.messages[0];
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Let me look that up.');
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toEqual({
      id: 'toolu_01',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: JSON.stringify({ city: 'Paris' }),
      },
    });
  });

  it('converts tool_result blocks to separate tool role messages', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: 'Sunny, 22°C',
            },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: 'tool',
      content: 'Sunny, 22°C',
      tool_call_id: 'toolu_01',
    });
  });

  it('converts tool_result with text block array content', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_02',
              content: [
                { type: 'text', text: 'Part A. ' },
                { type: 'text', text: 'Part B.' },
              ],
            },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages[0].content).toBe('Part A. Part B.');
    expect(result.messages[0].tool_call_id).toBe('toolu_02');
  });

  it('converts multiple tool_results to multiple tool messages', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_01', content: 'Result A' },
            { type: 'tool_result', tool_use_id: 'toolu_02', content: 'Result B' },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].tool_call_id).toBe('toolu_01');
    expect(result.messages[1].tool_call_id).toBe('toolu_02');
  });

  it('converts tools array to OpenAI function tools', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    };
    const result = anthropicToOpenAI(req);
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    });
  });

  it('converts tool_choice auto → "auto"', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'auto' },
    };
    expect(anthropicToOpenAI(req).tool_choice).toBe('auto');
  });

  it('converts tool_choice any → "required"', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'any' },
    };
    expect(anthropicToOpenAI(req).tool_choice).toBe('required');
  });

  it('converts tool_choice tool → function object', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    };
    expect(anthropicToOpenAI(req).tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('passes through temperature, top_p, stop_sequences, metadata user_id', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ['STOP'],
      metadata: { user_id: 'user_abc' },
    };
    const result = anthropicToOpenAI(req);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stop).toEqual(['STOP']);
    expect(result.user).toBe('user_abc');
  });

  it('silently drops top_k', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'Hi' }],
      top_k: 40,
    };
    const result = anthropicToOpenAI(req);
    expect((result as Record<string, unknown>).top_k).toBeUndefined();
  });

  describe('needsMaxCompletionTokens (tested via anthropicToOpenAI)', () => {
    it('uses max_tokens for standard GPT models', () => {
      const req: AnthropicRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_tokens).toBe(1024);
      expect(result.max_completion_tokens).toBeUndefined();
    });

    it('uses max_completion_tokens for o1 models', () => {
      const req: AnthropicRequest = {
        model: 'o1-preview',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 2048,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_completion_tokens).toBe(2048);
      expect(result.max_tokens).toBeUndefined();
    });

    it('uses max_completion_tokens for o3 models', () => {
      const req: AnthropicRequest = {
        model: 'o3-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 512,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_completion_tokens).toBe(512);
      expect(result.max_tokens).toBeUndefined();
    });

    it('uses max_completion_tokens for gpt-5 models', () => {
      const req: AnthropicRequest = {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 4096,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_completion_tokens).toBe(4096);
      expect(result.max_tokens).toBeUndefined();
    });

    it('uses max_completion_tokens for gpt-5.1', () => {
      const req: AnthropicRequest = {
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 4096,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_completion_tokens).toBe(4096);
      expect(result.max_tokens).toBeUndefined();
    });

    it('uses max_completion_tokens for gpt-5-mini', () => {
      const req: AnthropicRequest = {
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1000,
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_completion_tokens).toBe(1000);
    });

    it('respects profileModel for max_completion_tokens decision', () => {
      const req: AnthropicRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
      };
      // Using profileModel = o1 should trigger max_completion_tokens
      const result = anthropicToOpenAI(req, 'o1-mini');
      expect(result.max_completion_tokens).toBe(1024);
      expect(result.max_tokens).toBeUndefined();
    });

    it('omits both max_tokens fields when max_tokens is not set', () => {
      const req: AnthropicRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const result = anthropicToOpenAI(req);
      expect(result.max_tokens).toBeUndefined();
      expect(result.max_completion_tokens).toBeUndefined();
    });
  });
});

// ── openAIToAnthropic ────────────────────────────────────────────────────────

describe('openAIToAnthropic', () => {
  it('converts a basic text response', () => {
    const res = makeOpenAIResponse();
    const result = openAIToAnthropic(res, 'claude-3-5-sonnet-20241022');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(result.stop_reason).toBe('end_turn');
    expect(result.stop_sequence).toBeNull();
  });

  it('prefixes id with msg_ when it does not already start with msg_', () => {
    const res = makeOpenAIResponse({ id: 'chatcmpl-abc' });
    const result = openAIToAnthropic(res, 'claude-3-5-sonnet-20241022');
    expect(result.id).toBe('msg_chatcmpl-abc');
  });

  it('does not double-prefix id that already starts with msg_', () => {
    const res = makeOpenAIResponse({ id: 'msg_already' });
    const result = openAIToAnthropic(res, 'claude-3-5-sonnet-20241022');
    expect(result.id).toBe('msg_already');
  });

  it('maps finish_reason stop → end_turn', () => {
    const res = makeOpenAIResponse();
    expect(openAIToAnthropic(res, 'model').stop_reason).toBe('end_turn');
  });

  it('maps finish_reason tool_calls → tool_use', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: [] },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(openAIToAnthropic(res, 'model').stop_reason).toBe('tool_use');
  });

  it('maps finish_reason length → max_tokens', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'truncated' },
          finish_reason: 'length',
        },
      ],
    });
    expect(openAIToAnthropic(res, 'model').stop_reason).toBe('max_tokens');
  });

  it('maps unknown finish_reason → end_turn', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: 'content_filter',
        },
      ],
    });
    expect(openAIToAnthropic(res, 'model').stop_reason).toBe('end_turn');
  });

  it('maps null finish_reason → end_turn', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: null,
        },
      ],
    });
    expect(openAIToAnthropic(res, 'model').stop_reason).toBe('end_turn');
  });

  it('converts tool_calls to tool_use content blocks', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_01',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const result = openAIToAnthropic(res, 'model');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_01',
      name: 'get_weather',
      input: { city: 'Paris' },
    });
  });

  it('uses empty object for tool call with malformed JSON arguments', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_bad',
                type: 'function',
                function: { name: 'broken', arguments: '{invalid json' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const result = openAIToAnthropic(res, 'model');
    const block = result.content[0] as { type: string; input: unknown };
    expect(block.type).toBe('tool_use');
    expect(block.input).toEqual({});
  });

  it('includes both text and tool_use blocks when both are present', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Let me check.',
            tool_calls: [
              {
                id: 'call_01',
                type: 'function',
                function: { name: 'lookup', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const result = openAIToAnthropic(res, 'model');
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('tool_use');
  });

  it('maps usage tokens correctly', () => {
    const res = makeOpenAIResponse({
      usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
    });
    const result = openAIToAnthropic(res, 'model');
    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(17);
  });

  it('defaults usage to 0 when usage is absent', () => {
    const res = makeOpenAIResponse({ usage: undefined });
    const result = openAIToAnthropic(res, 'model');
    expect(result.usage.input_tokens).toBe(0);
    expect(result.usage.output_tokens).toBe(0);
  });

  it('produces empty content array when message has null content and no tool_calls', () => {
    const res = makeOpenAIResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finish_reason: 'stop',
        },
      ],
    });
    const result = openAIToAnthropic(res, 'model');
    expect(result.content).toHaveLength(0);
  });
});

// ── createStreamState ────────────────────────────────────────────────────────

describe('createStreamState', () => {
  it('returns the expected initial shape', () => {
    const state = createStreamState('msg_test', 'gpt-4o');
    expect(state.messageId).toBe('msg_test');
    expect(state.model).toBe('gpt-4o');
    expect(state.inputTokens).toBe(0);
    expect(state.outputTokens).toBe(0);
    expect(state.currentBlockIndex).toBe(-1);
    expect(state.currentBlockType).toBeNull();
    expect(state.toolCallAccumulator).toBeInstanceOf(Map);
    expect(state.toolCallAccumulator.size).toBe(0);
    expect(state.headersSent).toBe(false);
  });
});

// ── openAIStreamChunkToAnthropic ─────────────────────────────────────────────

describe('openAIStreamChunkToAnthropic', () => {
  it('emits message_start, content_block_start, ping on first chunk', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    const chunk = makeStreamChunk('chatcmpl-1', 'gpt-4o', { content: 'Hi' });
    const events = openAIStreamChunkToAnthropic(chunk, state);

    const types = events.map((e) => e.event);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('ping');
    expect(types).toContain('content_block_delta');
    expect(state.headersSent).toBe(true);
  });

  it('updates messageId and model from first chunk', () => {
    const state = createStreamState('msg_init', 'old-model');
    const chunk = makeStreamChunk('chatcmpl-xyz', 'gpt-4o-new', { content: 'Hi' });
    openAIStreamChunkToAnthropic(chunk, state);
    expect(state.messageId).toBe('chatcmpl-xyz');
    expect(state.model).toBe('gpt-4o-new');
  });

  it('does not re-emit preamble on subsequent chunks', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    const chunk1 = makeStreamChunk('id1', 'gpt-4o', { content: 'Hello' });
    const chunk2 = makeStreamChunk('id1', 'gpt-4o', { content: ' world' });

    openAIStreamChunkToAnthropic(chunk1, state);
    const events2 = openAIStreamChunkToAnthropic(chunk2, state);

    const types2 = events2.map((e) => e.event);
    expect(types2).not.toContain('message_start');
    expect(types2).not.toContain('ping');
    expect(types2).toContain('content_block_delta');
  });

  it('emits text delta with correct content', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    const chunk = makeStreamChunk('id1', 'gpt-4o', { content: 'Hello' });
    const events = openAIStreamChunkToAnthropic(chunk, state);

    const deltaEvent = events.find((e) => e.event === 'content_block_delta');
    expect(deltaEvent).toBeDefined();
    const data = deltaEvent!.data as { delta: { type: string; text: string } };
    expect(data.delta.type).toBe('text_delta');
    expect(data.delta.text).toBe('Hello');
  });

  it('emits message_delta and message_stop on finish_reason stop', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    // First chunk to init headers
    openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', { content: 'Hi' }),
      state
    );
    // Final chunk with finish_reason
    const finalChunk = makeStreamChunk('id1', 'gpt-4o', {}, 'stop');
    const events = openAIStreamChunkToAnthropic(finalChunk, state);

    const types = events.map((e) => e.event);
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    const msgDelta = events.find((e) => e.event === 'message_delta');
    const data = msgDelta!.data as { delta: { stop_reason: string } };
    expect(data.delta.stop_reason).toBe('end_turn');
  });

  it('maps finish_reason tool_calls to tool_use stop_reason', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', { content: 'Processing' }),
      state
    );
    const finalChunk = makeStreamChunk('id1', 'gpt-4o', {}, 'tool_calls');
    const events = openAIStreamChunkToAnthropic(finalChunk, state);

    const msgDelta = events.find((e) => e.event === 'message_delta');
    const data = msgDelta!.data as { delta: { stop_reason: string } };
    expect(data.delta.stop_reason).toBe('tool_use');
  });

  it('handles a tool_call start chunk: emits content_block_stop and tool_use content_block_start', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    // Init headers with empty-content first chunk
    openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', { role: 'assistant' }),
      state
    );

    // Tool call start chunk
    const toolStartChunk = makeStreamChunk('id1', 'gpt-4o', {
      tool_calls: [
        { index: 0, id: 'call_abc', type: 'function', function: { name: 'my_tool', arguments: '' } },
      ],
    });
    const events = openAIStreamChunkToAnthropic(toolStartChunk, state);

    const types = events.map((e) => e.event);
    // Previous text block should be closed
    expect(types).toContain('content_block_stop');
    // New tool_use block should be opened
    expect(types).toContain('content_block_start');

    const cbStart = events.find(
      (e) =>
        e.event === 'content_block_start' &&
        (e.data as { content_block?: { type: string } }).content_block?.type === 'tool_use'
    );
    expect(cbStart).toBeDefined();
    const cbData = cbStart!.data as {
      index: number;
      content_block: { type: string; id: string; name: string };
    };
    expect(cbData.content_block.id).toBe('call_abc');
    expect(cbData.content_block.name).toBe('my_tool');

    expect(state.currentBlockType).toBe('tool_use');
    expect(state.toolCallAccumulator.get(0)).toBeDefined();
  });

  it('accumulates tool call arguments across chunks', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    openAIStreamChunkToAnthropic(makeStreamChunk('id1', 'gpt-4o', {}), state);

    // Tool call start
    openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', {
        tool_calls: [
          { index: 0, id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{"a"' } },
        ],
      }),
      state
    );

    // Arguments continuation
    const events = openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', {
        tool_calls: [{ index: 0, function: { arguments: ':1}' } }],
      }),
      state
    );

    const acc = state.toolCallAccumulator.get(0);
    expect(acc?.argumentsJson).toBe('{"a":1}');

    const deltaEvent = events.find((e) => e.event === 'content_block_delta');
    expect(deltaEvent).toBeDefined();
    const data = deltaEvent!.data as { delta: { type: string; partial_json: string } };
    expect(data.delta.type).toBe('input_json_delta');
    expect(data.delta.partial_json).toBe(':1}');
  });

  it('handles text delta after tool_use block: closes tool block and opens text block', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    openAIStreamChunkToAnthropic(makeStreamChunk('id1', 'gpt-4o', {}), state);

    // Transition to tool_use
    openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', {
        tool_calls: [
          { index: 0, id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
        ],
      }),
      state
    );
    expect(state.currentBlockType).toBe('tool_use');

    // Text delta after tool_use
    const blockIndexBefore = state.currentBlockIndex;
    const events = openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', { content: 'After tool' }),
      state
    );

    const types = events.map((e) => e.event);
    expect(types).toContain('content_block_stop');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(state.currentBlockType).toBe('text');
    expect(state.currentBlockIndex).toBe(blockIndexBefore + 1);
  });

  it('updates token counts from chunk usage', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    const chunk: OpenAIStreamChunk = {
      id: 'id1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    };
    openAIStreamChunkToAnthropic(chunk, state);
    expect(state.inputTokens).toBe(50);
    expect(state.outputTokens).toBe(20);
  });

  it('returns only preamble events when choices array is empty', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    const chunk: OpenAIStreamChunk = {
      id: 'id1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4o',
      choices: [],
    };
    const events = openAIStreamChunkToAnthropic(chunk, state);
    // Should emit preamble (message_start, content_block_start, ping) but nothing more
    const types = events.map((e) => e.event);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('ping');
    expect(types).not.toContain('content_block_delta');
    expect(types).not.toContain('message_stop');
  });

  it('handles a chunk with no content and no tool_calls (no extra events)', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    // First chunk to init headers
    openAIStreamChunkToAnthropic(makeStreamChunk('id1', 'gpt-4o', { content: 'Hi' }), state);
    // Chunk with empty delta
    const events = openAIStreamChunkToAnthropic(
      makeStreamChunk('id1', 'gpt-4o', {}),
      state
    );
    expect(events).toHaveLength(0);
  });

  it('sets currentBlockType to null after finish_reason', () => {
    const state = createStreamState('msg_init', 'gpt-4o');
    openAIStreamChunkToAnthropic(makeStreamChunk('id1', 'gpt-4o', { content: 'Hi' }), state);
    openAIStreamChunkToAnthropic(makeStreamChunk('id1', 'gpt-4o', {}, 'stop'), state);
    expect(state.currentBlockType).toBeNull();
  });
});
