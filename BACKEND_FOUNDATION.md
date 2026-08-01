# Backend Foundation & Authentication

Milestone 10 introduces a browser-local backend boundary. It deliberately performs **no internet requests** and does not replace the existing Express routes or AI Integration endpoint. Its public entry point is `window.BackendFoundation`.

## Architecture

The foundation uses four independent layers: UI modules call domain services; domain services call the API client or storage contract; the API client applies queue, timeout, retry, response normalization, and error normalization; finally the mock transport resolves an in-memory endpoint table. This boundary lets a future HTTP transport replace the mock without changing consumers.

## Auth Flow

Login and registration submit to the mock API client. Successful responses are normalized, tokens are delegated to `TokenManager`, and the safe user record is delegated to `SessionManager`. Forgot-password only confirms a simulated reset. Logout calls the mock endpoint and clears both stores. The bundled demo is `demo@aiadslab.local` / `demo123`.

## API Layer

`ApiClient` exposes `get`, `post`, `put`, and `delete`. Every request enters `RequestQueue`, is constrained by `withTimeout`, retried only for server-class failures by `withRetry`, and returns `{ ok, status, data, meta }`. `ApiError` supplies stable status and code fields. `config`, `baseUrls`, and the immutable environment configuration centralize future deployment settings.

Supported mock endpoints:

- `POST /auth/login`, `/auth/register`, `/auth/logout`, `/auth/refresh`, and `/auth/forgot-password`
- `GET /profile`, `/projects`, and `/history`
- `POST /projects` and `/history`
- `PUT /projects/:id`
- `DELETE /projects/:id`

## Storage Adapter

`LocalStorageAdapter` owns serialization and local persistence. `RemoteStorageAdapter` provides the same asynchronous operations against an isolated in-memory map. Project Workspace now reads and writes through the local adapter instead of accessing `localStorage` directly. Existing storage keys and payload shapes are preserved for Milestone 1–9 compatibility.

## Sync Flow

`SyncManager.sync()` accepts one resource or all resources. Its registry covers Projects, Prompt Studio, Consistency, Prompt Generator, AI Provider, Queue, Workflow, Assets, and History. A sync emits connection state, copies a timestamped mock snapshot to the remote adapter, and reports completion to Notification Center. Offline mode retains local data and makes no network attempt.

## Session Flow

`TokenManager` stores mock access/refresh tokens with an expiry. `SessionManager` stores a password-free user record, handles remember-login policy, and automatically restores an eligible session on application startup. `Auth.refresh()` rotates both mock tokens. This session is separate from the existing TikTok OAuth session.

## Future Backend Migration

1. Select base URLs from build-time environment values.
2. Replace `mockTransport` with a `fetch` transport implementing the same normalized response contract.
3. Move refresh tokens to secure, HTTP-only, same-site cookies.
4. Replace `RemoteStorageAdapter` with authenticated repository endpoints.
5. Add conflict versions, idempotency keys, and incremental sync cursors.
6. Retain `LocalStorageAdapter` as the offline cache and migration source.

## Folder Structure

```text
public/
  backend-foundation.js  API, auth, session, storage, and sync services
  account-workspace.js   profile, authentication, notification, and status UI
  workspace.js           existing project UI consuming the storage adapter
  index.html             responsive workspace surfaces
  style.css              account and operational status styling
test/
  backend-foundation.test.js
BACKEND_FOUNDATION.md
```

## Security Plan

The current credentials and tokens are demonstrative only and must never protect production data. Production migration will require TLS, server-side password hashing, HTTP-only refresh cookies, short-lived access tokens, CSRF protection, strict schema validation, rate limiting, session revocation, audit logging, encrypted secrets, least-privilege authorization, content-security policy, and redaction of credentials and tokens from telemetry. User-rendered strings remain escaped, and session records intentionally omit passwords.
