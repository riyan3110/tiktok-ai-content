# AI Provider Engine

## Architecture

The AI Provider Engine is a browser-only abstraction between Prompt Generator and future AI backends. Provider configuration, default routing, and generation history are isolated from the existing studio. Built-in providers are configuration templates; they do not contain SDKs and never initiate a network request.

Local storage contracts:

- `providers.config` — adapter configuration and obfuscated credentials.
- `providers.default` — selected text, image, and video provider IDs.
- `providers.history` — the latest mock generation metadata.

## Provider Adapter Pattern

Every provider shares one configuration shape and the conceptual adapter contract `buildRequest(prompt, config)`, `send(request)`, and `parseResponse(response)`. The current adapter is a deterministic mock. A future implementation can register provider-specific adapters without changing the page or prompt editor.

## Pipeline

```text
Prompt Generator → Provider Adapter → Request Builder → Response Parser → History
```

The playground moves through Preparing Prompt, Sending Request, Waiting AI, Receiving Response, and Completed. These are timed local state transitions. The history record stores provider, model, prompt, duration, status, and timestamp.

## Future Backend

A backend should own adapter registration, validation, rate limiting, retries, timeout enforcement, observability, and normalized response schemas. The browser should submit only a provider identifier and generation parameters to an authenticated application endpoint. Server-side jobs can stream sanitized status events back to the pipeline UI.

## Security

The milestone intentionally has no external AI integration. API keys are password inputs, masked by default, and only exposed after an explicit Show or Copy action. The local value is obfuscated to prevent casual plain-text display, **not encrypted**. Local storage cannot provide strong credential protection against scripts running on the same origin. Production credentials must never be persisted there.

## Credential Flow

Today, a credential is entered into a masked field, obfuscated, and saved locally for interface prototyping. Clear removes it immediately. Test Connection uses only the provider's enabled state and a mock timer.

In production, the credential must travel over TLS to an authenticated backend, be encrypted with a managed key service, be redacted from logs and responses, and be resolved server-side by provider ID. The frontend should receive only a non-secret credential fingerprint and connection status.
