# Prompt Generator Engine

## Architecture

Milestone 5 is a frontend-only module composed of the workspace route and three-panel shell in `public/index.html`, visual system in `public/style.css`, and isolated engine in `public/prompt-generator.js`. The engine does not change or call an API endpoint. It reads and writes browser storage directly, leaving the legacy Content Studio and Milestones 1–4 intact.

The page has three responsive responsibilities:

1. **Configuration** selects source records and output constraints.
2. **Live Prompt Editor** assembles modular sections, provides syntax highlighting, section controls, editing history, auto-save, copy, and export.
3. **Live Preview & Analysis** reports compatibility, warnings, prompt metrics, scene count, and quality score.

## Generator Flow

1. Load projects and Consistency libraries from `localStorage`.
2. Restore the last generator configuration from `prompt.generator`.
3. Resolve selected source records.
4. Normalize the records into the canonical prompt sections.
5. Include only enabled blocks in the prescribed order.
6. Render the editable prompt and run deterministic quality analysis.
7. Auto-save every configuration or editor change locally.
8. Copy, export, or save the configuration as a reusable preset.

No generative model request occurs in this flow.

## Data Pipeline

| Source | Storage key | Use |
| --- | --- | --- |
| Workspace Project | `ai-ads-lab-projects-v1` | Campaign, brand, product, category, brief |
| Character Library | `consistency.characters` | Identity, appearance, wardrobe, role |
| Product Library | `consistency.products` | Packaging, materials, colors, logo rules |
| Style Library | `consistency.styles` | Camera, lens, lighting, composition, negative prompt |
| Voice Library | `consistency.voice` | Language, gender, emotion, pace, accent |
| Prompt Studio | `ai-ads-lab-prompts-v1` | Existing authoring data remains available and unchanged |
| Generator draft | `prompt.generator` | Current input state and auto-saved output |
| Presets | `prompt.presets` | Named reusable configurations |
| History | `prompt.history` | Recent completed browser sessions |

All storage parsing is defensive. Missing libraries are represented by an empty selection state rather than an application error.

## Prompt Assembly

Assembly order is fixed and predictable:

1. Project
2. Character
3. Product
4. Scene
5. Camera
6. Lighting
7. Voice
8. Style
9. Negative Prompt
10. Technical Notes

Each section has an independent toggle. Disabled or empty optional sections are excluded. The technical section translates Target AI, prompt type, language, duration, aspect ratio, and platform into explicit constraints. Analysis is local and deterministic: it estimates tokens from word count, detects repeatedly duplicated terms, identifies missing consistency inputs, counts scene references, checks target compatibility, and calculates a quality score.

Exports support plain text, Markdown, and structured JSON. JSON includes configuration, assembled prompt, and current analysis.

## Future AI Integration

A future adapter can accept the assembled prompt as an immutable request payload. Target-specific adapters should live behind one interface, implement provider capability metadata, and return normalized validation and generation events. Streaming output can update a separate result view; it should never overwrite the authored prompt without user confirmation. Provider credentials must not be stored in the browser.

## Backend Plan

A later backend can add versioned endpoints for server-side preset sync, prompt validation, provider execution, job history, and team workspaces. Recommended boundaries are:

- `PromptAssembler` for shared schema validation and canonical ordering.
- `ProviderAdapter` for Flow, Veo, Vidu, Kling, Runway, and other capabilities.
- `GenerationJob` for queued execution, progress, cancellation, and retry.
- encrypted server-side credential storage with workspace-level access control.
- append-only prompt and output versions for auditability.

Until that backend milestone, the engine remains local-only and makes no AI API request.
