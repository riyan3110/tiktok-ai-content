# Real AI Provider Connector — Milestone 11

## Architecture

Prompt Generator → `ProviderFactory` → shared `ProviderAdapter` contract → backend transport → Generation Queue → persisted history. Provider-specific request construction is isolated in adapters; adding a provider only requires registering its adapter and defaults in the factory.

## Secure configuration

`GET/PUT /api/ai/providers/:provider` manages base URL, organization ID, region, default model, timeout, retry count, and enabled state. API keys are encrypted at rest with AES-256-GCM. Responses return only `hasApiKey` and a fixed mask; plaintext keys are never returned, logged, or persisted in the browser. Use `DELETE /api/ai/providers/:provider/key` to remove a key.

## Execution and streaming

- `POST /api/ai/generations` executes and persists a generation.
- `POST /api/ai/generations/stream` emits NDJSON progress records and a normalized result.
- `POST /api/ai/generations/:id/cancel` aborts an active request.
- `GET /api/ai/generations` returns queue/history usage records.

Lifecycle states are Preparing, Sending, Waiting, Receiving, Retrying, Completed, Cancelled, and Failed. Provider errors normalize to Authentication Error, Quota Exceeded, Rate Limited, Timeout, Network Error, Model Not Found, or Unknown Error.

## Health and usage

Connection tests collect provider version, default model, response time, and provider information. The health monitor persists Online/Offline, latency, last success/failure, and quota status. Generation records include provider/model, token usage, estimated cost, timestamps, endpoint, and request/output byte sizes.

## Adding a provider

Create a subclass of `ProviderAdapter`, override only endpoint, headers, request, or response parsing as required, then add it to `DEFINITIONS`. Prompt Generator and Workflow require no changes.
