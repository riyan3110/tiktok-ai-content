# Milestone 12 — Real Media Generation Engine

The Express backend now provides a provider-neutral media pipeline for text, image, and video generation. Existing provider configuration remains compatible; Google Veo requests use the existing `google-omni` configuration alias so installations from Milestone 11 require no migration.

## API

- `POST /api/ai/generations` executes one request and returns its completed history record.
- `POST /api/ai/jobs` queues a background request.
- `POST /api/ai/generations/batch` queues 1–20 requests with bounded concurrency.
- `GET /api/ai/generations/:id` returns the result, media, prompt, provider, model, duration, status, metadata, and cost.
- `POST /api/ai/generations/:id/cancel` cancels an active request using `AbortController`.
- `POST /api/ai/jobs/:id/cancel` also removes pending work from the worker queue.
- `POST /api/ai/generations/:id/retry` creates a manual retry while retaining the original history record.
- `POST /api/ai/generations/:id/continue` resumes a non-terminal polling job.
- `POST /api/ai/generations/stream` streams newline-delimited progress events.

## Request shape

```json
{
  "provider": "runway",
  "model": "gen3a_turbo",
  "mediaType": "video",
  "prompt": "A cinematic product reveal",
  "duration": 5,
  "aspectRatio": "9:16",
  "assets": [{ "type": "reference-product", "url": "https://example.test/product.png" }]
}
```

Asset types are `image`, `storyboard`, `reference-character`, `reference-product`, `audio`, and `video`. Assets can use a provider-accessible `url` or a `data` value. The request builder validates and normalizes these values before the adapter is invoked. Provider adapters own endpoint, authentication, payload, and response normalization, while the worker owns concurrency, cancellation, lifecycle progress, retry dispatch, and cleanup.

Progress states emitted by the engine include Preparing, Uploading, Waiting, Generating, Rendering, Downloading, Completed, Failed, and Cancelled. Media adapters poll asynchronous provider job IDs until a terminal response, respecting cancellation and a bounded polling limit. Provider-specific rendering/polling states can be normalized by a new adapter without changing Prompt Generator or Workflow.
