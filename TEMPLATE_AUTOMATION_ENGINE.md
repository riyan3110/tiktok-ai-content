# Milestone 13 — Template & Automation Engine

## Ringkasan

Milestone ini menambahkan library template persisten untuk target **image, video, text, dan workflow**, sembilan preset bawaan, variable dinamis, preview/composer, estimasi token dan biaya, version history, asset linkage, run history, export, serta automation sekali, batch, queue, dan terjadwal.

## API

- `GET /api/templates` — list/search/filter (`search`, `category`, `folder`, `targetAI`, `favorite`, `archived`).
- `POST /api/templates` — create dan validasi template.
- `PUT /api/templates/:id` — edit, favorite, archive, folder/tag; setiap update membuat versi.
- `DELETE /api/templates/:id` — delete beserta version/assets/run melalui foreign key.
- `POST /api/templates/:id/generate` — compose lalu kirim 1–100 job ke Generation Queue, atau simpan run terjadwal.
- Endpoint pendukung: duplicate, preview, versions, runs, dan export JSON/Markdown/TXT.

## Variable dan composer

Placeholder bawaan: `product`, `brand`, `character`, `voice`, `duration`, `language`, `style`, `camera`, `lighting`, `cta`, dan `hook`. Variable lain wajib dideklarasikan pada objek `variables`. Composer menggabungkan context template, project, consistency, product, character, Prompt Studio, dan variable request. Generation ditolak bila placeholder belum memiliki nilai.

## Automation

Kirim `mode` berupa `once`, `batch`, `queue`, atau `scheduled`. Batch menerima 1–100 item (UI menyediakan shortcut 1/10/50/100). Mode scheduled juga mewajibkan `scheduledAt`. Semua eksekusi dicatat di `template_runs`; job non-scheduled diteruskan ke Media Generation Worker dan Provider Manager yang telah ada.

## Database

- `templates`: konfigurasi generation dan metadata library.
- `template_versions`: snapshot immutable setiap create/edit.
- `template_assets`: reference image/aset template.
- `template_runs`: provider, model, final prompt, durasi, biaya, status dan schedule.

Schema memakai `CREATE TABLE IF NOT EXISTS`, sehingga database dan perilaku Milestone 1–12 tetap kompatibel.
