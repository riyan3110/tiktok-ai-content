# Audit Teknis TikTok AI Content

**Tanggal audit:** 31 Juli 2026
**Cakupan:** seluruh berkas yang dilacak Git pada checkout project, tanpa membaca atau mengubah `.env`, database runtime, konfigurasi PM2, Hermes AI, maupun service yang berjalan. Path deployment `/var/www/tiktok-ai-content` tidak tersedia di lingkungan audit; audit dilakukan pada checkout repository yang disediakan di `/workspace/tiktok-ai-content`.
**Sifat perubahan:** dokumentasi saja. Tidak ada refactor atau perubahan perilaku aplikasi.

## Ringkasan eksekutif

Project ini adalah aplikasi web monolitik Node.js 20 untuk membuat carousel TikTok berbahasa Indonesia. Express menyajikan dashboard statis dan API, modul konten memanggil provider AI melalui SDK OpenAI-compatible, Sharp merender slide JPEG 1080×1920, SQLite menyimpan konten/jadwal/token OAuth, dan scheduler in-process mengirim draft melalui TikTok Content Posting API.

Fondasi fungsionalnya cukup baik untuk deployment pribadi satu proses: query database memakai parameter binding, foreign key dan WAL diaktifkan, OAuth memakai state acak, URL media diverifikasi, job scheduler diklaim secara atomik, dan terdapat 119 automated test yang lulus saat audit. Namun, aplikasi **belum aman bila dashboard dapat dijangkau publik**. Semua endpoint baca/tulis dan OAuth tidak memiliki autentikasi/otorisasi aplikasi; tidak ada proteksi CSRF atau rate limit. Akibatnya pengunjung yang dapat menjangkau host berpotensi membuat konten berbayar, mengubah atau menghapus data, mengendalikan jadwal, dan mengirim draft menggunakan token TikTok tersimpan.

Risiko penting lain adalah token OAuth disimpan plaintext, secret sesi mempunyai fallback yang diketahui, session memakai MemoryStore bawaan, dependency lockfile tidak dilacak, migrasi database tersebar sebagai `ALTER TABLE` saat startup, serta pekerjaan AI/render/network yang berat berlangsung langsung di request atau event loop scheduler. Prioritas pertama sebaiknya hardening akses dan secret, lalu reproducible dependency management serta migrasi/queue yang lebih matang.

## Metode dan batasan audit

- Menelaah seluruh file yang dilacak oleh Git: konfigurasi contoh, dokumentasi, schema, backend, frontend, service, dan test.
- Menjalankan syntax check dan keseluruhan test suite; **119/119 test lulus**.
- Mencoba audit dependency, tetapi `npm audit --omit=dev` tidak dapat berjalan karena repository tidak mempunyai `package-lock.json`.
- Mencoba memeriksa versi package terbaru, tetapi akses registry mendapat HTTP 403 dari kebijakan lingkungan. Karena itu status CVE dan freshness dependency **belum dapat dinyatakan bersih**.
- Tidak mengakses `.env`, database runtime, PM2/runtime process, Nginx server aktif, TikTok, provider AI, atau endpoint trending nyata. Temuan konfigurasi produksi perlu divalidasi kembali di host deployment.
- Audit bersifat static/code review dan test lokal, bukan penetration test atau load test.

## Struktur project

```text
.
├── .env.example                 # kontrak environment tanpa secret nyata
├── database/schema.sql          # schema SQLite idempotent
├── ecosystem.config.cjs         # deklarasi PM2 satu instance (tidak diubah)
├── nginx/tiktok-ai-content.conf # contoh reverse proxy
├── public/
│   ├── index.html               # dashboard single-page tanpa framework
│   ├── app.js                   # state, request API, dan render DOM
│   ├── style.css                # seluruh styling responsif
│   ├── privacy.html / terms.html
│   ├── assets/                  # logo
│   └── generated/               # hasil render yang disajikan publik
├── src/
│   ├── server.js                # bootstrap HTTP, cron, dan tick scheduler
│   ├── app.js                   # seluruh route/middleware Express
│   ├── config.js                # pemetaan environment dan validasi AI
│   ├── db.js                    # koneksi serta migrasi kompatibilitas
│   └── services/
│       ├── content.js           # prompt, parsing, normalisasi, validasi AI
│       ├── generation.js        # orkestrasi generate → render → persist
│       ├── images.js            # layout SVG dan render JPEG dengan Sharp
│       ├── tiktok.js            # OAuth dan Content Posting API
│       ├── automation.js        # jadwal, state machine, retry, polling
│       ├── trendReferences.js   # referensi tren manual
│       ├── trendingTopics.js    # adapter endpoint tren eksternal
│       ├── history.js           # penghapusan record dan gambar
│       └── contentOptions.js    # allowlist kategori/format
└── test/                        # 12 file test Node test runner/Supertest
```

## Stack dan package

| Lapisan | Teknologi | Peran/catatan |
|---|---|---|
| Runtime | Node.js `>=20`, CommonJS | Runtime tunggal backend dan scheduler. |
| Web/API | Express 5.1, `express-session` | JSON/form API, static assets, OAuth session. |
| Frontend | HTML, CSS, vanilla JavaScript | Tidak ada build step atau framework client. |
| Database | SQLite melalui `better-sqlite3` | Penyimpanan sinkron lokal, WAL, foreign key. |
| AI | SDK `openai` 4.x | Chat Completions ke Gemini, Groq, atau OpenAI-compatible base URL. Tidak ditemukan integrasi Hermes AI di source yang diaudit. |
| Gambar | Sharp 0.33 | SVG internal → JPEG RGB/sRGB 1080×1920. |
| Scheduling | `node-cron` + interval 30 detik | Cron generate harian dan automation queue in-process. |
| Integrasi | Native `fetch` | TikTok OAuth/post status, URL media, dan trending API. |
| Test | `node:test`, Supertest | Unit/integration-style test dengan SQLite memory/temp. |
| Proses/reverse proxy | PM2 satu instance, Nginx | Cocok dengan state lokal, tetapi menjadi single point of failure. |

Dependency langsung di `package.json`: `better-sqlite3`, `dotenv`, `express`, `express-session`, `node-cron`, `openai`, `sharp`; dev dependency: `supertest`. Tidak ada lockfile yang dilacak sehingga graph dependency transitif dan hasil `npm ci` tidak reproducible.

## API yang teridentifikasi

| Method | Endpoint | Fungsi | Mengubah state? | Kontrol akses saat ini |
|---|---|---|---|---|
| GET | `/`, `/terms`, `/privacy`, static | Dashboard/legal/media | Tidak | Publik |
| GET | `/auth/tiktok` | Mulai OAuth TikTok | Sesi | Publik |
| GET | `/auth/tiktok/callback` | Tukar code dan simpan token | Ya | Hanya validasi state sesi |
| GET | `/tiktok/connection-status` | Status token tersimpan | Tidak | Publik |
| GET | `/trend-references/current` | Referensi tren terbaru | Tidak | Publik |
| POST/PUT | `/trend-references`, `/trend-references/:id` | Buat/perbarui referensi | Ya | **Tidak ada** |
| POST/DELETE | `/trend-references/:id/disable`, `/trend-references/:id` | Nonaktif/hapus referensi | Ya | **Tidak ada** |
| POST | `/generate` | Panggil AI, render, simpan | Ya/berbiaya | **Tidak ada** |
| POST | `/upload-tiktok` | Kirim draft foto TikTok | Ya | **Tidak ada** |
| GET | `/status/:publishId` | Poll status dan update content | Ya | **Tidak ada** |
| GET/DELETE | `/history`, `/history/:id` | Baca/hapus riwayat | Ya untuk DELETE | **Tidak ada** |
| POST/GET | `/automation/schedules`, `/automation/today` | Buat/baca jadwal | Ya untuk POST | **Tidak ada** |
| POST | `/automation/schedules/:id/:action` | Pause/resume/cancel | Ya | **Tidak ada** |
| POST | `/automation/jobs/:id/:action` | Send-now/cancel/retry | Ya | **Tidak ada** |

Tidak ada API versioning, OpenAPI specification, health/readiness endpoint, pagination, atau request correlation ID.

## Database dan model data

SQLite mempunyai empat tabel:

1. `contents`: output AI, metadata kategori/format/tren, path slide, status/publish ID, dan error TikTok. `topic` unik secara default SQLite (case-sensitive).
2. `trend_reference_sets`: keyword/hook/pola sebagai string JSON, sumber, region, intensity, masa berlaku, dan status aktif.
3. `oauth_tokens`: access/refresh token TikTok, expiry, open ID, dan scope; token disimpan plaintext.
4. `automation_schedules` dan `automation_jobs`: jadwal induk, sudut konten, epoch schedule/retry, state job, attempt, dan relasi content.

`createDatabase()` membuat schema lalu melakukan rangkaian pemeriksaan kolom dan `ALTER TABLE` untuk kompatibilitas database lama. Tidak ada tabel versi schema, nomor migrasi, transaksi migrasi eksplisit, backup/rollback procedure, atau test upgrade dari setiap versi historis.

## Arsitektur dan alur utama

### Generate manual/AI/trending

1. Browser memanggil `POST /generate`.
2. `generation.js` memvalidasi mode/kategori/format, mengambil 50 topik dan 15 content terbaru, serta optional trend reference.
3. `content.js` menyusun prompt dan schema, memanggil Chat Completions, mem-parse JSON, menormalisasi serta memperbaiki output maksimal dua kali.
4. Similarity/duplikasi diperiksa maksimal tiga attempt.
5. `images.js` membuat layout SVG dan merender 3–5 JPEG.
6. Metadata/path disimpan ke `contents`; dashboard mengambil record dan menampilkan preview.

### Upload TikTok

Route memuat content, refresh token bila perlu, memvalidasi file lokal dan URL JPEG publik, lalu menginisiasi `MEDIA_UPLOAD`. Publish ID dan status disimpan; browser melakukan polling endpoint status.

### Automation

Jadwal dan angle dibuat lewat request. Interval di `server.js` memanggil `tick()` setiap 30 detik. Job due diklaim dengan conditional update `WAITING → GENERATING`, lalu generate, render, validasi, refresh token, dan upload dilakukan berurutan. Job gagal dapat dicoba sekali setelah 10 menit; job terlambat lebih dari 30 menit ditandai `MISSED`. State tertentu dipulihkan ke antrean saat startup.

## Temuan bug dan risiko

### High

#### H-01 — Tidak ada autentikasi dan otorisasi dashboard/API

Semua route operasional dapat dipanggil oleh siapa pun yang dapat menjangkau aplikasi. Ini mencakup membaca konten, menghabiskan kuota AI/render, menghapus riwayat/gambar, mengganti referensi tren, membuat/mengubah jadwal, memulai OAuth, serta mengirim draft ke akun TikTok yang tokennya tersimpan. Nginx contoh juga meneruskan seluruh request tanpa access control.

**Dampak:** pengambilalihan fungsi aplikasi, kebocoran konten, biaya provider, kehilangan data, dan penyalahgunaan akun TikTok.
**Rekomendasi:** tambah autentikasi operator (SSO atau local admin dengan password hash), middleware deny-by-default, authorization untuk seluruh API dan static generated media sensitif, serta batasi aplikasi di VPN/IP allowlist sampai kontrol aplikasi tersedia.

#### H-02 — Endpoint mutasi tidak dilindungi CSRF

Cookie sesi menggunakan `SameSite=Lax`, tetapi tidak ada CSRF token atau validasi `Origin`/`Referer`. Begitu autentikasi ditambah—atau pada browser/network tertentu—request mutasi dapat dipicu lintas situs. Beberapa aksi sensitif memakai POST/PUT/DELETE, tetapi method saja bukan proteksi CSRF.

**Rekomendasi:** CSRF token per sesi untuk browser flow, verifikasi origin, cookie `Secure`/`HttpOnly`/`SameSite` yang sesuai, dan pisahkan API token bila ada client non-browser.

#### H-03 — Secret sesi mempunyai fallback publik

Jika `SESSION_SECRET` tidak terpasang, aplikasi tetap startup dengan nilai literal `development-only-change-me`, termasuk ketika `NODE_ENV=production`. Penyerang yang mengetahui default dapat memalsukan cookie bertanda tangan; ini sangat berbahaya saat session dipakai untuk OAuth state dan nantinya autentikasi.

**Rekomendasi:** fail-fast pada production bila secret kosong/default/terlalu pendek dan dokumentasikan rotasi secret. Jangan menampilkan nilainya di log.

#### H-04 — OAuth token TikTok disimpan plaintext

Access dan refresh token disimpan langsung pada SQLite. Kompromi file database/backup atau pembacaan filesystem memberikan credential aktif. Tidak ada application-level encryption atau key management.

**Rekomendasi:** enkripsi token at rest memakai envelope encryption/KMS atau minimal key terpisah dari database, permission file/backup ketat, audit akses, prosedur revoke/rotasi, dan mekanisme disconnect yang benar-benar menghapus/revoke token.

#### H-05 — Tidak ada rate limit, quota, atau pembatas concurrency pekerjaan mahal

`/generate`, upload, status, OAuth, dan automation dapat dipanggil tanpa rate limit. Generate mengeksekusi request AI dan Sharp dalam lifecycle HTTP; spam paralel dapat menghabiskan API quota, CPU, memory, disk, dan event loop. Limit jumlah automation per hari juga hanya per schedule, bukan global/operator.

**Rekomendasi:** rate limit per user/IP, quota harian, concurrency semaphore/queue, idempotency key, ukuran/input limit eksplisit, storage quota/retention, dan backpressure.

### Medium

#### M-01 — Dependency graph tidak reproducible dan belum dapat diaudit

Repository tidak melacak `package-lock.json`, sedangkan README menyuruh `npm ci`; pada clean checkout, `npm ci` memerlukan lockfile. Rentang caret dapat memilih dependency transitif berbeda antar deployment. `npm audit` gagal karena tidak ada lockfile, sehingga status vulnerability tidak diketahui.

**Rekomendasi:** hasilkan dan commit lockfile dengan versi npm yang disepakati, gunakan `npm ci`, jalankan audit/SCA/Dependabot di CI, serta tetapkan kebijakan update dan pengecualian CVE.

#### M-02 — Session memakai MemoryStore dan cookie production tidak lengkap

`express-session` memakai MemoryStore bawaan: sesi hilang saat restart, tidak cocok untuk scale-out, dan dokumentasi package memperingatkan store ini bukan untuk production. Cookie tidak memiliki nama khusus; tidak ada explicit rolling/regeneration flow. OAuth state tersimpan hanya 10 menit dan sesi dapat hilang jika proses restart di tengah flow.

**Rekomendasi:** persistent shared session store, regenerate session saat login/privilege change, nama cookie non-default, secret rotation, dan konfigurasi environment-aware yang tervalidasi.

#### M-03 — Migrasi schema ad hoc saat startup

Schema baseline dan 18 pemeriksaan `ALTER TABLE` berada di `db.js`. Tidak ada versi, checksum, urutan migration formal, rollback, atau transaction menyeluruh. Dua instance/startup bersamaan berisiko race; kegagalan di tengah dapat meninggalkan schema parsial.

**Rekomendasi:** migration runner/version table, migration immutable berurutan dalam transaksi, backup sebelum upgrade, dan integration test dari snapshot schema lama.

#### M-04 — Pemeriksaan duplikasi topik tidak atomik dan tidak sesuai constraint DB

Aplikasi menormalisasi kapital/spasi dengan memuat semua `topic` lalu membandingkannya di JavaScript, tetapi constraint `UNIQUE(topic)` hanya membandingkan string mentah. Request bersamaan dapat sama-sama lolos pre-check lalu menyimpan variasi case/spacing; full-table scan juga melambat saat data tumbuh.

**Rekomendasi:** simpan `normalized_topic`, beri unique index, lakukan insert atomik dan tangani conflict. Backfill/deduplikasi harus direncanakan sebagai migrasi.

#### M-05 — Tidak ada timeout/cancellation yang konsisten untuk outbound HTTP

Native `fetch` ke TikTok, media URL, dan trending API tidak memakai `AbortSignal.timeout`. Endpoint lambat dapat menahan request/job serta flag scheduler lebih lama. Validasi media juga mengunduh seluruh file ke memory tanpa batas byte eksplisit.

**Rekomendasi:** timeout per tahap, batas response size/content-length, retry dengan exponential backoff dan jitter untuk error transient, circuit breaker, serta klasifikasi error provider.

#### M-06 — Error internal dan data AI terlalu mudah masuk log/response

Error middleware mengembalikan `err.message` untuk error 500. `content.js` mencatat raw AI response ketika parsing/validasi gagal, yang dapat berisi prompt/output pengguna atau data bisnis. Test juga memperlihatkan log layout yang sangat bising dari renderer.

**Dampak:** information disclosure ke client/log, data retention tak terkontrol, dan signal operasional tertutup noise.
**Rekomendasi:** pesan 5xx generik dengan error ID; structured logging berlevel dan redaction; raw model response hanya pada debug opt-in dengan retensi terbatas; hapus `console.log` hot path.

#### M-07 — Action endpoint dapat memberi sukses palsu untuk resource yang tidak ada/tidak berubah

`scheduleAction()` tidak memeriksa `changes`, lalu dapat mengembalikan `null` dengan HTTP 200 untuk schedule yang tidak ada. `send-now`/`retry` juga tidak memeriksa hasil conditional update sebelum menjalankan tick dan mengembalikan row; action pada state yang tidak valid dapat tampak sukses. ID `NaN` tidak divalidasi konsisten.

**Rekomendasi:** validasi integer positif, bedakan 404 dan 409, periksa affected rows pada setiap state transition, serta tambah test negative path.

#### M-08 — State machine automation tidak didefinisikan/diterapkan terpusat

Status berupa string bebas di database tanpa CHECK constraint. Transition tersebar dalam SQL literal di route dan service; respons status eksternal TikTok ditulis langsung sebagai status job. Konstanta `FINAL` ada tetapi cakupan status/transition tidak menjadi satu sumber kebenaran.

**Rekomendasi:** enum/transition map terpusat, CHECK constraint, adapter mapping status TikTok, compare-and-set untuk setiap transition, state diagram, dan invariant tests.

#### M-09 — Arsitektur request/scheduler in-process membatasi reliability dan throughput

Pekerjaan AI, Sharp, validasi download, upload, serta polling berada dalam satu proses web. SQLite dan banyak query sinkron memblokir event loop. Restart setelah upload eksternal tetapi sebelum persist dapat menyebabkan hasil tak sinkron/duplikasi; hanya sebagian state dipulihkan. Satu instance menghindari beberapa race tetapi menjadi single point of failure.

**Rekomendasi:** pindahkan pekerjaan berat ke durable queue/worker, gunakan idempotency/outbox, simpan checkpoint sebelum/selesai external side effect, dan tetapkan recovery/reconciliation job. Pertahankan single instance sampai shared coordination tersedia.

#### M-10 — Tidak ada lifecycle storage/retention yang terotomasi

Generated JPEG disajikan statis dan tetap ada sampai history dihapus. Tidak ada quota disk, retention job, orphan reconciliation, atau monitoring free space. Crash di antara render dan insert dapat meninggalkan orphan file.

**Rekomendasi:** policy retensi, quota, scheduled cleanup aman, reconciliation DB↔filesystem, atomic staging/rename, dan alert disk usage.

#### M-11 — `.gitignore` tidak mengabaikan output JPEG aktual

Renderer menghasilkan `.jpg`, tetapi `.gitignore` hanya mengabaikan `public/generated/*.png`. Output runtime JPEG dapat tidak sengaja masuk commit dan membocorkan konten/menambah ukuran repository.

**Rekomendasi:** pada PR terpisah, ignore `.jpg`/`.jpeg` sambil mempertahankan `.gitkeep`, dan tambah check CI untuk generated artifacts. Tidak diubah dalam audit dokumentasi ini.

### Low

#### L-01 — Router/controller terlalu padat dan duplikasi token refresh

`src/app.js` memuat middleware, seluruh route, SQL, orchestration, serialization, dan error handling dalam satu file dengan banyak statement satu baris. `validToken()` diduplikasi di `app.js` dan `automation.js`, sehingga behavior expiry/error dapat menyimpang.

**Rekomendasi:** setelah hardening, pisahkan router/controller/use-case/repository; buat satu token service yang dites. Hindari refactor besar sebelum characterization test cukup.

#### L-02 — Query history dan daftar hari ini tidak scalable

`GET /history` mengambil seluruh row termasuk body/slide JSON tanpa pagination. `listToday` menjalankan query job per schedule (pola N+1). `isDuplicate` membaca seluruh topic setiap attempt, dan beberapa history query diulang dalam loop generate.

**Rekomendasi:** cursor pagination, select kolom ringkas untuk list, batch query jobs, index sesuai query, dan ukur dengan realistic dataset sebelum optimasi.

#### L-03 — JSON dalam kolom tidak tervalidasi saat dibaca

`JSON.parse` dipanggil langsung pada `slides`, `hashtags`, dan metadata tren. Corruption/manual data lama dapat mengubah satu row menjadi HTTP 500 atau menghentikan job.

**Rekomendasi:** helper parse tervalidasi dengan error domain/telemetry, schema validation saat write, dan migration/recovery untuk row rusak.

#### L-04 — Konfigurasi numerik dan URL belum divalidasi lengkap

Port, opacity, font size, cron expression, TikTok credential/redirect URI, public base URL HTTPS-production, dan timezone tidak seluruhnya divalidasi saat startup. Nilai `NaN`/out-of-range dapat gagal terlambat di runtime. `AI_BASE_URL` hanya diuji sebagai URL, tidak dibatasi ke HTTPS.

**Rekomendasi:** schema konfigurasi terpusat, fail-fast berbasis environment, range/enum/HTTPS checks, dan test konfigurasi invalid.

#### L-05 — API contract dan observability minimal

Tidak ada OpenAPI, health/readiness, metrics, tracing, request ID, audit trail operator, atau monitoring scheduler lag. `updated_at` harus diperbarui manual pada setiap query dan tidak ada database trigger.

**Rekomendasi:** OpenAPI sebagai contract, health endpoint tanpa secret, metrics latency/error/queue/disk/provider, correlation ID, audit log untuk tindakan sensitif, dan alert.

#### L-06 — Test kuat di domain tertentu tetapi gap keamanan/operasional masih besar

Suite sangat baik untuk normalisasi konten, layout, URL TikTok, duplikasi, dan scheduler happy/error paths. Belum terlihat test auth/authz, CSRF, rate limit, security headers, session production, migration fixture historis, concurrent HTTP generation, timeout, large payload, malformed stored JSON, disk full, atau end-to-end provider sandbox.

**Rekomendasi:** tambahkan security integration tests, migration tests, failure injection, concurrency/load baseline, dan contract tests untuk provider.

#### L-07 — Dokumentasi deployment berpotensi memberi rasa aman berlebih

README menyatakan session memory “aman” untuk satu instance; satu instance hanya menghindari sharing session, bukan membuat MemoryStore production-grade. Instruksi `npm ci` juga tidak dapat direproduksi tanpa lockfile.

**Rekomendasi:** koreksi dokumentasi setelah keputusan session/lockfile dibuat, sertakan threat model, backup/restore drill, rollback, dan runbook incident.

## Kekurangan arsitektur

1. **Tidak ada boundary identitas/otorisasi.** Aplikasi menganggap siapa pun di network adalah operator tepercaya.
2. **Web, worker, scheduler, dan integration side effects menyatu.** Failure domain dan resource contention sama.
3. **Persistence concern bocor ke route/service.** SQL tersebar, tidak ada repository/unit-of-work atau migration lifecycle formal.
4. **State machine implisit.** Automation status/transition tidak memiliki kontrak tunggal dan constraint database.
5. **Single-node state.** SQLite, filesystem generated, MemoryStore, dan interval lokal mengunci deployment pada satu proses/host.
6. **Tidak ada idempotency/outbox.** External side effect TikTok dan commit lokal tidak atomik.
7. **Kontrak eksternal lemah.** Timeout, size limits, retry policy, error mapping, dan telemetry tidak seragam.
8. **Operability belum menjadi fitur.** Tidak ada health, metrics, audit trail, retention automation, atau documented disaster recovery.
9. **Supply-chain control belum lengkap.** Lockfile/SCA/CI policy tidak tersedia.
10. **Separation of concerns terbatas.** Controller besar dan fungsi token refresh duplikat meningkatkan biaya perubahan.

## Hal positif yang perlu dipertahankan

- Parameter binding dipakai pada query yang ditinjau; tidak ditemukan SQL string interpolation dari input request.
- Kategori, format, action, source, intensity, dan pola tertentu memakai allowlist.
- OAuth state dibuat dengan `crypto.randomBytes`; cookie `HttpOnly` dan conditional `Secure` sudah digunakan.
- Media TikTok dibatasi ke origin/path terverifikasi, JPEG, HTTP 200, tanpa redirect, dan non-empty.
- Path penghapusan gambar memiliki test traversal/ownership.
- Foreign key dan WAL SQLite diaktifkan; claim scheduler memakai conditional update.
- Input AI diparse, dinormalisasi, dan divalidasi ketat; output SVG meng-escape XML dan frontend meng-escape mayoritas data dinamis.
- Suite 119 test mencakup domain konten/layout/automation/integrasi dengan breadth yang baik.

## Rekomendasi dan roadmap prioritas

### High — segera sebelum exposure publik diperluas

1. Letakkan akses sementara di VPN/IP allowlist atau identity-aware proxy.
2. Implementasikan autentikasi operator, authorization deny-by-default, CSRF protection, dan security headers.
3. Hapus fallback session secret di production; validasi seluruh secret saat startup.
4. Enkripsi/proteksi OAuth token, tambah disconnect/revoke dan audit access.
5. Terapkan rate limit, quota, concurrency cap, request/body limit, dan storage guard.
6. Buat lockfile, jalankan `npm ci` serta SCA pada CI; triage seluruh temuan dependency sebelum release.

### Medium — sprint berikutnya

1. Gunakan persistent session store dan definisikan lifecycle session.
2. Introduksi migration framework/version table beserta backup/upgrade tests.
3. Tambah `normalized_topic` unique dan idempotency key untuk generate/upload/action.
4. Standardisasi HTTP client: timeout, response-size cap, retry/jitter, redaction, error mapping.
5. Formalisasikan state machine automation dan constraint status; perbaiki 404/409 pada action endpoint.
6. Pisahkan durable worker/queue secara bertahap; tambahkan outbox/reconciliation untuk TikTok.
7. Tambah retention/quota/reconciliation generated images dan ignore output JPEG.
8. Terapkan structured logging, generic 5xx, request ID, metrics, health/readiness, serta alert.

### Low — setelah risiko utama terkendali

1. Pisahkan router/controller/use-case/repository dan konsolidasikan token service.
2. Tambah pagination history, batch query schedule, index hasil profiling, dan cache/read optimization bila perlu.
3. Tambah schema validation stored JSON dan configuration schema fail-fast.
4. Dokumentasikan OpenAPI, state diagram, threat model, backup/restore, rollback, incident response, dan data retention.
5. Perluas test ke security, migration, concurrency, load, timeout, corrupted data, disk-full, dan sandbox contract.

## Prioritas temuan ringkas

| ID | Prioritas | Ringkasan |
|---|---|---|
| H-01 | High | Tidak ada auth/authz untuk dashboard dan API sensitif |
| H-02 | High | Tidak ada CSRF protection |
| H-03 | High | Fallback session secret diketahui publik |
| H-04 | High | OAuth token plaintext di SQLite |
| H-05 | High | Tidak ada rate limit/quota/concurrency guard |
| M-01 | Medium | Lockfile tidak ada; audit dependency tidak dapat dilakukan |
| M-02 | Medium | MemoryStore untuk session production |
| M-03 | Medium | Migrasi schema ad hoc saat startup |
| M-04 | Medium | Duplikasi topik non-atomik/tidak sejajar dengan DB constraint |
| M-05 | Medium | Outbound request tanpa timeout/size cap konsisten |
| M-06 | Medium | Raw AI/error/log noise berisiko membocorkan data |
| M-07 | Medium | Action endpoint dapat memberi HTTP 200 palsu |
| M-08 | Medium | State machine automation berupa string bebas/tersebar |
| M-09 | Medium | Web dan pekerjaan berat/scheduler satu proses |
| M-10 | Medium | Tidak ada retention/quota/reconciliation storage |
| M-11 | Medium | JPEG runtime tidak di-ignore Git |
| L-01 | Low | Controller padat dan token refresh duplikat |
| L-02 | Low | History tak berpaginasi, N+1, full scans |
| L-03 | Low | Stored JSON diparse tanpa recovery |
| L-04 | Low | Validasi konfigurasi belum lengkap |
| L-05 | Low | API contract dan observability minimal |
| L-06 | Low | Gap test security/operasional |
| L-07 | Low | Dokumentasi deployment perlu dikoreksi |

## Verifikasi audit

| Pemeriksaan | Hasil |
|---|---|
| `npm run check` | Lulus |
| `npm test` | Lulus: 119 test, 0 gagal |
| `npm audit --omit=dev` | Tidak dapat dijalankan: `ENOLOCK` |
| `npm outdated` | Tidak dapat diselesaikan: registry mengembalikan HTTP 403 pada lingkungan audit |
| `git diff --check` | Lulus |

## Definition of done yang disarankan untuk fase perbaikan

- Setiap temuan High mempunyai owner, target date, test keamanan, dan bukti rollout.
- Tidak ada endpoint mutasi atau data sensitif yang dapat diakses anonymous.
- Clean checkout dapat menjalankan `npm ci`, syntax check, test, dan dependency scan secara deterministik.
- Migration diuji dari snapshot produksi yang dianonimkan dan mempunyai backup/rollback runbook.
- External request mempunyai timeout dan batas ukuran; pekerjaan mahal mempunyai queue/concurrency control.
- Metrics dan alert mencakup auth failures, generate/upload failure, scheduler lag, queue depth, disk, DB, dan provider latency.
- Token/secret tidak muncul dalam response/log/backup plaintext yang tidak terlindungi.
- Perubahan dilakukan dalam PR kecil terpisah; dokumen audit ini sendiri tidak mengubah perilaku aplikasi.
