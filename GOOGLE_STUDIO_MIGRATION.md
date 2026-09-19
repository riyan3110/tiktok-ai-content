# Google Studio backup migration

Source repositories reviewed before retirement:

- `riyan3110/tiktok-ai-content-aistudio` — older Google AI Studio copy.
- `riyan3110/tiktok-ai-content-google-studio` — later backup/checkpoint copy.

Source checkpoint reviewed: `ed54eb1eb1afd0a4f8ed21173eb5875038a1d909`.
Latest follow-up reviewed: `3e42f46963db00af2f91b911297d15c7d3c78628`.

## Preserved in the canonical repo

- Simple **Buat Prompt dengan AI** workflow using the configured Text AI, including an optional gallery reference image.
- Early neo-theme bootstrapping to avoid a flash of the old/dark shell before deferred UI assets load.
- Removal of the document-wide automation-suspension MutationObserver while keeping initial application and hash-change behavior.
- Safe UI refinements for the prompt form, chat panel, trend reference card, and profile layout.
- Cache/version wiring and regression tests for the migrated behavior.

## Intentionally not copied over older code

Provider/model files from the Google backup were not used to replace the canonical implementation. The canonical repository contains newer provider routing, strict deletion, legacy-provider cleanup, independent Text/Image credentials, and explicit fallback behavior from PRs #296–#300. Copying the older Google provider snapshot would regress those changes.

The final Google backup `PORT` fix is already present in the canonical `src/config.js` (`Number(process.env.PORT || 3000)`).

This migration is intentionally additive/surgical: unrelated AI Ads Lab features and AI Ads Keyboard are not replaced by the backup snapshot.
