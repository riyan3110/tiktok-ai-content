# Milestone 14 — Asset Management & Tencent COS

## Architecture

Asset Manager depends on `StorageService` and `AssetRepository`, never on a concrete cloud SDK. `StorageAdapter` defines upload, delete, copy, move, and rename operations. `LocalStorageAdapter` and `TencentCosAdapter` implement that contract, so S3, R2, GCS, or Azure adapters can be registered without changing the repository or UI.

Tencent COS support includes object upload/delete/copy/move/rename, HEAD metadata, public and signed URLs, and multipart initiation, part upload, and completion. COS requests use backend-generated authorization. Credentials use AES-256-GCM at rest; public settings only expose a fixed mask. Browser uploads are converted to a backend request and credentials never enter frontend JavaScript.

## Asset lifecycle

The library supports image, video, audio, storyboard, character/product references, prompt attachments, and generated media. Assets retain provider, checksum, tags, folders, metadata, favorite/trash state, and generated status. Search supports keyword, type, provider, dates, size, favorite, folder, and trash. Duplicate checks use SHA-256. Storage settings include quota, retention, automatic deletion policy, versioning, encryption, HTTPS, URL expiry, and public URL.

When Tencent COS upload fails, `StorageService` transparently retries through local storage and records the fallback reason in asset metadata. Generation pipelines can save normalized provider/model/prompt/negative prompt/seed/resolution/duration/cost/generation-time values through the same `upload({ generated: true, metadata })` boundary. `window.AssetManager.select()` provides the provider-neutral selection boundary for Workflow and Prompt Generator.

## Operations

Configure **Settings → Storage**, save credentials, then use **Test Connection**. The result reports connectivity, latency, bucket status, validated permission, storage usage, and quota. Local files live under `data/assets` and are served through the dedicated `/asset-files` route. COS never falls back for destructive operations, preventing a failed cloud delete from accidentally targeting a local object.

## Milestone 15 — Asset Integration

Prompt Generator, Workflow Builder, and Content Studio now share one responsive **Select from Assets** modal. Consumers persist internal `assetIds`, while `POST /api/assets/resolve` resolves Local Storage or Tencent COS locations on the server immediately before use. The selector supports category, search, favorite, folder, multi-select, and preview workflows. Public URLs are never a required input; Copy URL remains available only under the Asset Manager's Advanced menu, alongside the primary Download and Delete lifecycle actions.
