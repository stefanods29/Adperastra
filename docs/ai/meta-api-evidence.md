# Meta Model API evidence (Step 17a)

Research date: 2026-11-02. This file paraphrases the official documentation
used by the step guide. It contains no account data, key, model weight or
invented measurement. The coordinator must re-open these pages before a real
provider run and record the new date here.

| Topic | Documented decision used by 17a |
|---|---|
| API reference | <https://dev.meta.ai/docs/api-reference> |
| Models | <https://dev.meta.ai/docs/models> |
| Chat Completions | <https://dev.meta.ai/docs/protocols/chat-completions> |
| Structured output | <https://dev.meta.ai/docs/structured-output> |
| Tool calling | <https://dev.meta.ai/docs/tool-calling> |

## Fixed transport

- Base `https://api.meta.ai/v1`.
- `Authorization: Bearer <key>`; the key is held only by the native gateway.
- `POST /chat/completions`; explicit `GET /models` only on a user Test/List
  action.
- Default model `muse-spark-1.3` (Standard). Contributor model IDs are not
  accepted in 17a.
- The app sends `model`, `messages`, `max_completion_tokens`, `stream` and an
  app-owned `response_format` with `json_schema`. `tools` are typed developer
  function definitions nested under `function`; no built-in `web_search` or
  `tool_search`.
- Streaming uses `choices[].delta.content` SSE frames and a final `[DONE]`.
  Non-streaming JSON uses `choices[].message.content`.
- Every provider content string is parsed and validated again by the app;
  the provider's schema/structured-output promise is not an authority.
- No Meta Files/Responses server-side state, no automatic paid retry, no
  redirects, no proxies. A 401/429/5xx stops the request and offers a
  user-chosen Retry (which needs a fresh consent and may cost money) or Local
  AI. There is no automatic cloud fallback.

## What this evidence does not prove

- No real request, account, key, charge or model download was performed while
  writing this guide or the worker handoff.
- The exact response schema, tool-call envelope and SSE framing must be
  re-verified against a real provider by the coordinator with the owner's
  explicit account/cost approval before any provider capability is enabled.
- `muse-spark-1.3` availability depends on the owner's account; a missing
  model is an error, not a fallback to another model.
