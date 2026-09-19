# AI Ads Lab — Provider/Model review

Status: DRAFT — not deployed and not end-to-end accepted.

## Scope

Only AI Ads Lab provider UI and backend provider routing were edited. AI Ads Keyboard was not accessed or changed. The Provider section of index.html was replaced; separate Text/Image forms now expose five management buttons plus one Save button per form; other HTML sections, shared styles, login, prompts and content composition rules were preserved. Changes to content generators are client construction only. Content Studio backend changes expose the saved provider defaults and route generation; its frontend is unchanged.

## Changes

- Explicit Text/Image enrollment, independent active providers/models and fallback toggles. No automatic legacy provider migration or seeding.
- Backend model discovery with authenticated HTTP requests. Authentication is checked against a deliberately invalid key on models/key/auth-key endpoints. A public catalog alone cannot validate credentials; unsupported authentication checks reject saving.
- AES-256-GCM credentials with a randomly generated persistent backend key (data/.provider-encryption-key, permission 0600, excluded from git). Existing encrypted records remain readable for migration. No stored key or ciphertext in public provider state; upstream error bodies are not relayed.
- Deletion removes matching legacy settings, defaults, health and capability cache, and selects a replacement enrolled in the same category. A revision number keyed by opaque provider ID remains to stop stale saves/requests; it contains no credentials, URL, model or active/fallback reference.
- Fallback OFF attempts only the selected provider. ON considers only saved providers enrolled in that category; deleted records are rechecked before each attempt.
- Text generation clients use one runtime router. The queue connector resolves current Text/Image defaults instead of submitted legacy provider IDs. Results report the responding provider/model and time.
- Identical Base URLs can now store separate Text/Image credentials and model catalogs. The previous URL uniqueness constraint is migrated and existing enrolled shared records are split.
- Startup removes the retired AI_PROVIDER/AI_API_KEY/AI_BASE_URL/AI_MODEL and XKIRO_API_KEY/XKIRO_BASE_URL/XKIRO_MODEL variables from this app environment file and its records in PM2 dump files, retaining login/storage and other apps. Runtime config no longer reads the old Text Content credentials. This cleanup has been tested on temporary files; it has NOT run on the VPS.
- Provider page keeps its existing CSS and uses backend null/default state. Legacy static cards/search/Video default were removed from the initial HTML. Provider/model names are escaped in attributes.

## Verification performed

- Node 22.16.0: syntax checks passed; git diff --check passed.
- 86 local tests passed: 14 provider/state/HTTP contract/environment-retirement tests and 72 existing content regression tests. Existing HTTP contract tests use an injected test transport and are NOT proof of real provider generation.
- A real request to the OpenAI API using a deliberately invalid credential was rejected; the provider was not stored. Initial Node DNS failure was resolved for this test using the environment's configured proxy via a temporary test bootstrap. No production network configuration was changed.
- Database deletion was checked after closing the database and reopening it in a separate Node process. This is not a PM2/VPS restart test.
- An executable DOM test passed using jsdom and the real local provider API: two forms, five management buttons, independent toggles and unsaved inputs, absent legacy UI. This is not a visual browser test.
- Server startup reached its listen callback. The available cloud browser blocked the local URL with ERR_BLOCKED_BY_CLIENT. No visual/browser acceptance is claimed.

## Requested tests A–J

| Test | Result |
| --- | --- |
| A — save a valid Text provider and list real models | BLOCKED: no valid test credentials supplied. Real invalid-key rejection passed separately. |
| B — selected provider/model returns an answer | BLOCKED: requires a valid Text provider. Local HTTP contract tests passed. |
| C — fallback OFF with a failing active provider | Local routing/HTTP contract checks passed. Real provider acceptance pending. |
| D — fallback ON reaches another saved provider | Local routing/HTTP contract checks passed. Two real provider credentials required. |
| E — delete, reload, restart | Database deletion and separate-process reopen passed. Browser reload and PM2/VPS restart pending. |
| F — deleted provider excluded from fallback | Local tests passed. Real-provider fallback pending. |
| G — Chat and Text Content use the same selected model | Client construction unified; content regression tests passed. Real Chat + Text Content execution pending. |
| H — separate Image provider does not change Text | Database and same-URL/different-key isolation passed, including deleting Image while retaining Text. Real Image generation pending. |
| I — Default Video AI removed | Provider source and executable DOM checks passed. Browser visual verification pending. |
| J — legacy cards/search removed | Provider source and executable DOM checks passed. Browser visual verification pending. |

## Deployment access

SSH to the previously supplied UpCloud host could not connect from this session (Network is unreachable). No VPS files, production process, or live settings have been changed.

## Remaining acceptance requirements

Use an isolated staging instance with two real Text provider credentials and one Image provider credential entered through its provider UI or a secret environment store. Do not put credentials in the PR or chat. Run the live test suite with AIADS_RUN_LIVE_TESTS=1 and AIADS_TEST_TEXT_URL/KEY, AIADS_TEST_SECOND_URL/KEY (optional *_MODEL selectors). The current live harness covers A–F; G/H require the application workflows and I/J require a browser. Test PM2 restart and production legacy configuration separately before merge/deployment.

Existing unverified/migrated profiles are retained for explicit deletion but are not automatically enrolled for execution. They must be saved with valid credentials for their intended category. This intentional migration behavior requires review against the deployed database.

The implementation targets OpenAI-compatible model discovery and chat/responses/image APIs. Providers requiring a different protocol or lacking a verifiable authentication endpoint may be rejected; they have not been verified. Role enrollment is explicit; per-model capability metadata is not classified automatically. Image-reference requests use images/edits for locally stored assets and require provider support.

## Files changed

- `.gitignore`
- `PROVIDER_MODEL_REVIEW.md`
- `public/ai-providers-simple.js`
- `public/index.html`
- `src/ai/connector.js`
- `src/ai/mediaWorker.js`
- `src/app.js`
- `src/config.js`
- `src/server.js`
- `src/services/autoSourceDynamicTopicPlan.js`
- `src/services/autoSourceFinalizer.js`
- `src/services/autoSourceIndonesianOutput.js`
- `src/services/autoSourceMultiEntityComposer.js`
- `src/services/autoSourcePlanFinalizer.js`
- `src/services/autoSourceResearchComposer.js`
- `src/services/autoSourceResilientFinalizer.js`
- `src/services/autoSourceSimpleComposer.js`
- `src/services/autoSourceStrictFinalizer.js`
- `src/services/autoSourceTopicLockedComposer.js`
- `src/services/content.js`
- `src/services/contentStudio.js`
- `src/services/dynamicAiProviders.js`
- `src/services/dynamicTextBridge.js`
- `src/services/legacyTextEnvironment.js`
- `src/services/manualSourceDedupe.js`
- `src/services/manualSourceRoleGuard.js`
- `src/services/nineRouterModels.js`
- `src/services/orcaRouterModels.js`
- `src/services/sourceFilter.js`
- `src/services/sourceUrlFinalizer.js`
- `src/services/textInputComposer.js`
- `src/services/textProviderRuntime.js`
- `test/content.test.js`
- `test/dynamic-provider-live.test.js`
- `test/dynamic-provider-state.test.js`
- `test/dynamicAiProviders.test.js`
- `test/legacy-text-environment.test.js`
