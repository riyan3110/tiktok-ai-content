# Production AI Provider Integration

## Configuration

Open **AI Providers**, select a provider, enter its API key, enable it, optionally edit the model/base URL, click **Set as Default**, save, and run **Test Connection**. Credentials are AES-256-GCM encrypted with the server session secret; API responses expose only `hasApiKey` and a fixed mask, never the credential.

Generation clients use `POST /api/generate/image` or `POST /api/generate/video`. Both return a queued job ID. Poll `/api/generate/jobs/:id`; completed remote media is downloaded and passed unchanged into `StorageService`, which selects Local or Tencent COS and registers it in Asset Manager and generation history.

## Provider availability

- OpenAI Images, Google Gemini, Google Imagen, Google Veo, and Vidu have concrete request adapters. Account/model availability, billing, regional restrictions, and preview allow-listing still apply.
- Google Flow currently has no supported public generation API. Its adapter deliberately returns an explicit `501` rather than simulating a result. Use only an officially approved enterprise endpoint when Google provides one.
- “Omni” is vendor-ambiguous and requires a vendor-issued endpoint and contract. The adapter refuses the placeholder endpoint with `501`; after a real endpoint is configured it uses the standard provider contract.
- Veo uses a long-running prediction operation. Production credentials must be entitled to the configured preview model; deployments requiring OAuth/Vertex service-account authentication need an approved token broker rather than an API key.

## Standard contract

Requests accept `prompt`, `negativePrompt`, `referenceAssets`, `aspectRatio`, `duration`, `resolution`, `style`, `seed`, and `model`. Job responses expose `status`, `provider`, `jobId`, `previewUrl`, `downloadUrl`, `storageUrl`, and `metadata`. Provider failures are isolated on their job with an error message and can be retried through the existing history/content-studio actions.
