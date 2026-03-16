/**
 * Proxy server lifecycle and HTTP handler.
 * Bridges Claude Code's Anthropic Messages API calls to OpenAI-compatible endpoints.
 */

import { randomBytes } from 'crypto';
import type { Profile } from '../types.js';
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  openAIStreamChunkToAnthropic,
  createStreamState,
  type AnthropicRequest,
  type OpenAIResponse,
  type OpenAIStreamChunk,
  type AnthropicEvent,
  type StreamState,
} from './proxy-convert.js';

export interface ProxyHandle {
  port: number;
  baseUrl: string;
  /** Per-session bearer token; set as ANTHROPIC_API_KEY so Claude Code can authenticate. */
  authToken: string;
  stop: () => Promise<void>;
}

/**
 * Returns true if this profile needs the built-in proxy.
 */
export function needsProxy(profile: Profile): boolean {
  return profile.provider === 'openai-compatible';
}

/**
 * Encode a single Anthropic SSE event as a string.
 */
function encodeEvent(ev: AnthropicEvent): string {
  return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

/**
 * Convert an upstream SSE body to a stream of Anthropic SSE events.
 */
async function convertStreamAsync(
  upstreamBody: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  requestedModel: string,
  signal?: AbortSignal
): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstreamBody.getReader();
  const state: StreamState = createStreamState(`msg_proxy_${Date.now()}`, requestedModel);
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Stream aborted');
      }
      const readPromise = reader.read();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Stream read timeout')), 30_000)
      );
      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          // Flush any lingering state — emit message_stop if not already sent
          if (state.headersSent && state.currentBlockType !== null) {
            const ev: AnthropicEvent = {
              event: 'content_block_stop',
              data: { type: 'content_block_stop', index: state.currentBlockIndex },
            };
            controller.enqueue(encoder.encode(encodeEvent(ev)));
            state.currentBlockType = null;
          }
          continue;
        }

        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(dataStr) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        const events = openAIStreamChunkToAnthropic(chunk, state);
        for (const ev of events) {
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        }
      }
    }
  } catch (err) {
    const errorEvent: AnthropicEvent = {
      event: 'error',
      data: {
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : String(err),
        },
      },
    };
    controller.enqueue(encoder.encode(encodeEvent(errorEvent)));
  } finally {
    reader.releaseLock();
    controller.close();
  }
}

/**
 * Build the Bun fetch handler for the proxy.
 * authToken is the per-session bearer token Claude Code sends as ANTHROPIC_API_KEY.
 */
function makeHandler(profile: Profile, authToken: string) {
  return async function handler(req: Request): Promise<Response> {
    // Verify per-session token to guard against DNS rebinding / local process snooping.
    // Anthropic SDK sends the API key as x-api-key; some clients use Authorization: Bearer.
    const xApiKey = req.headers.get('x-api-key');
    const authHeader = req.headers.get('Authorization');
    const tokenMatch =
      xApiKey === authToken || authHeader === `Bearer ${authToken}`;
    if (!tokenMatch) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);

    // GET /v1/models — minimal model list
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return Response.json({
        object: 'list',
        data: [{ id: profile.model || 'unknown', object: 'model' }],
      });
    }

    // POST /v1/messages — main proxy path
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      let body: AnthropicRequest;
      try {
        body = (await req.json()) as AnthropicRequest;
      } catch (err) {
        return Response.json(
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'Invalid JSON body' },
          },
          { status: 400 }
        );
      }

      const requestedModel = body.model;
      let openAIReq: ReturnType<typeof anthropicToOpenAI>;
      try {
        openAIReq = anthropicToOpenAI(body, profile.model);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[flip-cc proxy] Conversion error:', detail);
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Request conversion failed: ${detail}`,
            },
          },
          { status: 500 }
        );
      }

      const upstreamUrl = `${profile.baseUrl}/chat/completions`;

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${profile.apiKey}`,
          },
          body: JSON.stringify(openAIReq),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[flip-cc proxy] Upstream request error:', detail);
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Upstream request failed: ${detail}`,
            },
          },
          { status: 502 }
        );
      }

      // Upstream error
      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text().catch(() => 'Unknown error');
        return Response.json(
          {
            type: 'error',
            error: { type: 'api_error', message: errText },
          },
          { status: upstreamRes.status }
        );
      }

      const contentType = upstreamRes.headers.get('content-type') || '';
      const isStream = openAIReq.stream && contentType.includes('text/event-stream');

      if (isStream && upstreamRes.body) {
        const upstreamBody = upstreamRes.body;
        const reqSignal = req.signal;
        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            convertStreamAsync(upstreamBody, controller, requestedModel, reqSignal).catch((err) => {
              console.error('[flip-cc proxy] Stream error:', err instanceof Error ? err.message : String(err));
              controller.error(err);
            });
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      // Non-streaming response
      let openAIRes: OpenAIResponse;
      try {
        openAIRes = (await upstreamRes.json()) as OpenAIResponse;
      } catch (err) {
        return Response.json(
          {
            type: 'error',
            error: { type: 'api_error', message: 'Failed to parse upstream response' },
          },
          { status: 502 }
        );
      }

      try {
        const anthropicRes = openAIToAnthropic(openAIRes, requestedModel);
        return Response.json(anthropicRes);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[flip-cc proxy] Response conversion error:', detail);
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Response conversion failed: ${detail}`,
            },
          },
          { status: 500 }
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  };
}

/**
 * Start the proxy server for the given profile.
 * Returns a handle with the port, base URL, per-session auth token, and a stop() function.
 *
 * The auth token is an sk-ant-* format key (satisfies Claude Code's key validation) generated
 * fresh each session. Callers should set ANTHROPIC_API_KEY to this token so the proxy can
 * verify requests come from the local Claude Code process.
 */
export async function startProxy(profile: Profile): Promise<ProxyHandle> {
  // Must satisfy claude-code's sk-ant- prefix check and minimum length (~88 chars).
  // Generated fresh each session to prevent cross-process token reuse.
  const authToken = `sk-ant-proxy-${randomBytes(64).toString('base64url')}`;

  // Pass port: 0 directly to avoid TOCTOU race between findFreePort() and actual bind.
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: makeHandler(profile, authToken),
  });

  const actualPort = server.port ?? 0;
  // Use 127.0.0.1 explicitly — localhost may resolve to ::1 on some systems
  // but the server only binds to the IPv4 loopback address.
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  return {
    port: actualPort,
    baseUrl,
    authToken,
    stop: async () => {
      await server.stop(true);
    },
  };
}
