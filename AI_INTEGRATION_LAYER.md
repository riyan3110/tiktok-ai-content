# AI Integration Layer

## Architecture

The integration layer is the provider-neutral boundary between Prompt Generator, Generation Queue, and a future backend API. Milestone 8 runs entirely in the browser through deterministic mock adapters: **no network request is made**. Requests flow through Request Builder → Provider Adapter → Transport → Response Parser → Queue → History.

Local persistence is deliberately limited to `integration.config`, `integration.logs`, and `integration.health`. These contain presentation preferences, mock telemetry, and simulated health—not secrets.

## Adapter Pattern

`ProviderAdapter` exposes six operations: `buildRequest()`, `validate()`, `send()`, `parse()`, `cancel()`, and `health()`. Gemini Mock, OpenAI Mock, Claude Mock, Flow Mock, and Veo Mock use that same contract. The UI depends only on this interface and never on provider-specific payloads.

The request builder normalizes Prompt, System Prompt, Temperature, TopP, TopK, Seed, Model, Files, and Metadata. The response parser emits Content, Usage, Tokens, Images, Videos, Warnings, and Finish Reason.

## Transport Layer

The current transport is a timer-driven mock that simulates Connecting, Streaming, Receiving, and Completed states. It supports cancellation through `AbortController` without `fetch`, XHR, WebSocket, or SDK calls. Errors are normalized to Timeout, Rate Limit, Authentication Error, Validation Error, Network Error, or Unknown Error.

## Security Model

The frontend never accepts, persists, logs, or transmits a real API key. “Credential Status” is display-only and mock provider tokens are placeholders.

In production, credentials must be stored by the backend in an encrypted secret manager. The browser receives a short-lived authenticated application session, never the provider credential. The backend resolves the provider secret at execution time, limits its scope, redacts logs, rotates it, applies per-user authorization and rate limits, and records an audit event. TLS protects every browser/backend and backend/provider hop.

## Backend Contract

Suggested endpoints:

- `POST /api/v1/ai/jobs` accepts the normalized request and returns `{ jobId, status }`.
- `GET /api/v1/ai/jobs/:jobId` returns normalized status and response fields.
- `DELETE /api/v1/ai/jobs/:jobId` requests cancellation.
- `GET /api/v1/ai/providers/health` returns provider health without credential details.
- `GET /api/v1/ai/jobs/:jobId/events` opens an authenticated event stream.

The backend validates size and schema, authorizes provider/model access, attaches server-owned credentials, maps provider errors to the shared taxonomy, and returns only the normalized response envelope.

## Streaming Plan

The production transport can replace the mock timer with Server-Sent Events for one-way job updates or WebSocket where bidirectional control is required. Events should use `{ jobId, sequence, type, timestamp, payload }`, support reconnection via a cursor, send heartbeats, and end with exactly one completed, failed, or cancelled terminal event.

## Future API Integration

Implement a backend transport behind the existing adapter interface, feature-flag it per environment, and retain mock adapters for tests and previews. Add contract tests, idempotency keys, request timeouts, exponential retry with jitter, rate-limit handling, structured redacted telemetry, and server-side usage budgets before enabling any real provider.
