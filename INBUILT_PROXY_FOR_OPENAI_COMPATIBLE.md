# Built-in Anthropic↔OpenAI Proxy for OpenAI-Compatible Profiles

## Overview

Claude Code uses the Anthropic SDK internally, which always calls the Anthropic
Messages API (`POST /v1/messages`). Third-party providers like NVIDIA NIM,
Together AI, Groq, and Ollama only expose an OpenAI-compatible API
(`POST /v1/chat/completions`). flip-cc solves this with a lightweight proxy
bundled directly into the binary — zero external dependencies.

When launched with an `openai-compatible` profile, flip-cc:
1. Starts a local HTTP server on a random free port
2. Sets `ANTHROPIC_BASE_URL=http://localhost:<port>` so Claude Code talks to it
3. Translates every Anthropic Messages request → OpenAI Chat Completions request
4. Forwards the request to the real provider
5. Translates the response (or SSE stream) back to Anthropic format
6. Shuts down the proxy cleanly when Claude Code exits

---

## Architecture

```
Claude Code (Anthropic SDK)
        │
        │  POST /v1/messages  (Anthropic format)
        ▼
┌─────────────────────────┐
│   flip-cc Proxy Server  │   src/lib/proxy.ts
│   localhost:<random>    │
└─────────────────────────┘
        │
        │  POST /v1/chat/completions  (OpenAI format)
        ▼
  External Provider API
  (NVIDIA NIM, Groq, Together AI, Ollama, etc.)
```

### Integration in `launch.ts`

```
launchCommand()
  ├── buildEnvOverrides()
  ├── needsIsolatedHome()  →  createIsolatedHomeForApiKey()
  ├── needsProxy()         →  startProxy()  →  { port, baseUrl, stop() }
  │       overrides ANTHROPIC_BASE_URL=http://localhost:<port>
  ├── spawnWithInheritance('claude', ...)
  └── finally: proxyHandle.stop() + isolated home cleanup
```

---

## Source Files

| File | Purpose |
|------|---------|
| `src/lib/proxy.ts` | Server lifecycle (`needsProxy`, `startProxy`), HTTP handler, stream conversion |
| `src/lib/proxy-convert.ts` | Pure conversion functions — no I/O, fully unit-testable |

---

## Profile Requirements

An `openai-compatible` profile requires:
- `apiKey` — forwarded as `Authorization: Bearer <key>`
- `baseUrl` — upstream OpenAI endpoint (e.g. `https://api.groq.com/openai/v1`)
- `model` — forwarded in OpenAI request body; echoed back in Anthropic responses

---

## Request Conversion (Anthropic → OpenAI)

### Message Roles & Content

| Anthropic | OpenAI |
|-----------|--------|
| `role: "user"` | `role: "user"` |
| `role: "assistant"` | `role: "assistant"` |
| `content: string` | `content: string` |
| `content: [{type:"text", text}]` | `content: "..."` (join text parts) |
| `content: [{type:"image", source:{type:"base64",...}}]` | `content: [{type:"image_url", image_url:{url:"data:..."}}]` |
| `content: [{type:"tool_result",...}]` | `role: "tool"`, `tool_call_id`, `content` |

### System Prompt

```
Anthropic: { system: "...", messages: [...] }
OpenAI:    { messages: [{ role: "system", content: "..." }, ...] }
```

### Tool / Function Calling

| Anthropic | OpenAI |
|-----------|--------|
| `tools: [{name, description, input_schema}]` | `tools: [{type:"function", function:{name, description, parameters}}]` |
| `tool_choice: {type:"auto"}` | `tool_choice: "auto"` |
| `tool_choice: {type:"any"}` | `tool_choice: "required"` |
| `tool_choice: {type:"tool", name}` | `tool_choice: {type:"function", function:{name}}` |

### Other Fields

| Anthropic | OpenAI |
|-----------|--------|
| `max_tokens` | `max_tokens` |
| `temperature` | `temperature` |
| `top_p` | `top_p` |
| `stop_sequences` | `stop` |
| `metadata.user_id` | `user` |
| `top_k` | dropped (no equivalent) |

---

## Response Conversion (OpenAI → Anthropic)

### Non-Streaming

```
OpenAI finish_reason → Anthropic stop_reason:
  "stop"           → "end_turn"
  "tool_calls"     → "tool_use"
  "length"         → "max_tokens"
  anything else    → "end_turn"

OpenAI tool_calls[].function.arguments (JSON string)
  → Anthropic tool_use.input (parsed object)

OpenAI usage.prompt_tokens     → Anthropic usage.input_tokens
OpenAI usage.completion_tokens → Anthropic usage.output_tokens

model: always echo back the model string Claude Code sent in the request
```

### Streaming (SSE)

The proxy maintains a `StreamState` across chunks and emits Anthropic SSE events:

```
message_start         ← on first chunk
content_block_start   ← when a new text or tool_use block begins
ping                  ← after first message_start
content_block_delta   ← text_delta or input_json_delta per chunk
content_block_stop    ← when a block ends
message_delta         ← on finish_reason with stop_reason + output token count
message_stop          ← on [DONE]
```

Tool call arguments arrive as string fragments across chunks. The proxy accumulates them in `toolCallAccumulator` and emits `input_json_delta` events per fragment.

---

## Endpoints Handled

| Method | Path | Behaviour |
|--------|------|-----------|
| `POST` | `/v1/messages` | Full Anthropic→OpenAI proxy (streaming + non-streaming) |
| `GET` | `/v1/models` | Returns `[{id: profile.model, object: "model"}]` |
| anything else | `*` | 404 |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Upstream 4xx/5xx | Body wrapped in `{type:"error",error:{type:"api_error",message}}` |
| Conversion failure | HTTP 500 with Anthropic error envelope; logged to stderr |
| Network / timeout | 120 s default timeout via `AbortSignal.timeout(120_000)` |
| Port conflict | Avoided — `Bun.serve({ port: 0 })` lets the OS assign a free port atomically |

---

## VSCode Limitation

The proxy runs as a subprocess of `flip-cc launch`. When using the `vscode-config`
command, no flip-cc process is running, so the proxy cannot be used. Attempting to
apply a `vscode-config` for an `openai-compatible` profile will show a clear
warning and exit without writing settings.

---

## Edge Cases

| Case | Handling |
|------|----------|
| Provider doesn't support streaming | Proxy detects non-SSE response, converts single JSON |
| Tool arguments split across chunks | Accumulated via `toolCallAccumulator` before emitting |
| Multiple tool calls in one response | Each gets its own `content_block_start/stop` pair |
| Image content in messages | Base64 converted to `data:` URL format |
| `top_k` parameter | Silently dropped |
| Non-standard `finish_reason` | Maps to `end_turn` as safe default |
