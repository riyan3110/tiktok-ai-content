# Generation Queue & Job Manager

## Queue Architecture

The browser owns three versionable persistence boundaries: `queue.jobs` for live work, `queue.history` for immutable completion records, and `queue.settings` for worker policy. Prompt Generator publishes a normalized job to the queue; a provider label is metadata only. The pipeline is **Prompt Generator → Provider → Queue → Mock Worker → History** and makes no network or AI request.

## Worker Lifecycle

A timer claims waiting jobs up to the configured concurrency limit. Each job advances through deterministic checkpoints (0, 10, 25, 40, 60, 80, and 100 percent) and lifecycle states Preparing, Running, Uploading, Generating, Processing, then Completed. Pause prevents claiming and advancing work. Cancellation is terminal, while completed mock output is copied into history.

## Retry Strategy

Failed jobs may be retried individually or in bulk. Settings reserve retry count, delay, and auto-retry policy for a backend-compatible worker. Every retry increments the attempt counter and adds log and timeline events. A production worker should use exponential backoff with jitter, idempotency keys, and a dead-letter queue after the configured limit.

## Future Backend Queue

Replace the local adapter with authenticated enqueue, cancel, retry, and status endpoints. Server-sent events or WebSockets can stream progress while local storage remains an offline cache. Job IDs, normalized statuses, timestamps, results, logs, and actions deliberately mirror a backend job contract. Provider credentials must remain server-side.

## Scaling Plan

Move durable jobs to a transactional database and payloads/results to object storage. Use Redis, SQS, or a comparable broker for leasing and visibility timeouts. Scale provider-specific worker pools independently, enforce tenant concurrency and rate limits, deduplicate with idempotency keys, and add metrics for queue depth, latency, retries, failures, and worker saturation.
