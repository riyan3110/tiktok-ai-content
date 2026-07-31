# Consistency Engine

## Architecture

The Consistency Engine is a frontend-only workspace module. `public/consistency.js` owns state, rendering, validation, import/export, version snapshots, and browser persistence; `public/style.css` provides responsive presentation. It does not call or alter any API endpoint. The existing workspace router only toggles the new view, leaving Content Studio and prior milestones intact.

The UI has four reusable libraries (characters, products, styles, and voices) plus global defaults. Built-in style and voice presets are seeded once on first use. Reference images are read as data URLs for local previews and stored with their profile.

## Data structures

All library records share these fields:

```json
{
  "id": "uuid",
  "name": "Profile name",
  "favorite": false,
  "preset": false,
  "version": 1,
  "history": [],
  "images": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Character records add identity, appearance, wardrobe, style, and notes fields. Product records add brand, category, packaging, color, material, and logo fields. Style records add lighting, camera, lens, tone, composition, and negative prompt. Voice records add language, gender, emotion, speed, pitch, accent, and sample script.

When Auto Snapshot is enabled, editing adds the previous record to `history` and increments `version`. Duplicate creates a new identity with version 1. JSON import assigns a fresh local identity to avoid collisions.

## LocalStorage schema

| Key | Value |
| --- | --- |
| `consistency.characters` | JSON array of character records |
| `consistency.products` | JSON array of product records |
| `consistency.styles` | JSON array of style records |
| `consistency.voice` | JSON array of voice records |
| `consistency.settings` | Defaults and consistency/backup flags |

When Auto Backup Local is enabled, `consistency.backup` contains a timestamped recovery bundle. This extra recovery key does not replace the five canonical keys. Browser storage is limited, so reference images should remain compressed and modest in number.

## Backend integration plan

1. Introduce authenticated REST resources mirroring each library schema without changing current generation endpoints.
2. Add a repository adapter so the view can switch between local and remote stores.
3. Upload reference images to object storage and retain only URLs and metadata in records.
4. Add optimistic concurrency using record version and `updatedAt`.
5. Queue offline mutations and resolve conflicts explicitly after reconnect.
6. Let prompt generation consume resolved default/profile IDs through an additive integration.

## Future database migration

Create normalized `consistency_profiles`, profile-type detail tables, `profile_versions`, `profile_images`, and `consistency_settings` keyed by user/workspace. On first authenticated sync, read every canonical local key, validate and batch-upload records, map local UUIDs to database IDs, then verify server counts and checksums. Preserve local data until the user confirms migration. After successful verification, store a migration marker and retain a downloadable JSON backup. A compatibility adapter should continue reading old local records during a deprecation window.
