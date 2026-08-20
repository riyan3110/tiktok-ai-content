# Prompt Studio — Milestone 3

## Struktur Prompt Studio

Prompt Studio adalah tab di dalam detail setiap Project. Data dipisahkan berdasarkan `projectId` dalam key localStorage `ai-ads-lab-prompts-v1`, sehingga prompt suatu project tidak muncul di project lain. Implementasi ini sepenuhnya frontend dan tidak mengubah API, backend, Hermes AI, PM2, workflow TikTok, atau fitur Workspace yang sudah ada.

Satu prompt menyimpan `id`, `projectId`, judul, kategori, target AI, isi utama, notes, tags, favorite, status, nomor versi, timestamps, dan array snapshot versi. Kategori yang tersedia adalah Storyboard, Character, Product, Image, Video, Voice, Caption, dan Custom. Target AI mencakup Google Flow, Google Omni, Veo, Vidu, Kling, ChatGPT, Gemini, Claude, dan Custom.

## Komponen UI

- **Project tab:** Overview tetap tersedia dan tab Prompt Studio membuka modul project terkait.
- **Prompt list:** tabel Judul, Jenis Prompt, Target AI, Versi, Status, dan Last Edited, termasuk tombol bintang favorite.
- **Create Prompt:** dialog untuk judul, kategori, dan target AI.
- **Search dan filter:** pencarian gabungan judul/tag/kategori/target, filter kategori, target AI, dan favorite.
- **Prompt editor:** judul, prompt utama, notes, tags, serta toolbar Copy Prompt, Duplicate, Rename, dan Delete.
- **Empty/no-result state:** CTA Create Prompt saat project belum memiliki prompt dan pesan khusus saat hasil filter kosong.
- **Responsive layout:** tabel dapat digulir pada layar sempit; toolbar dan editor berubah menjadi layout satu kolom pada tablet/mobile.

## Alur Versioning

Prompt baru dimulai sebagai `v1` beserta snapshot kosong awal. Tombol **Simpan sebagai vN** membuat snapshot baru dari prompt utama, notes, dan tags, menaikkan nomor versi, serta memperbarui Last Edited. Riwayat ditampilkan terbaru ke terlama. Memilih versi lama memuat snapshot ke editor; perubahan baru tidak menimpa snapshot terdahulu dan baru persisten setelah disimpan sebagai versi berikutnya.

Duplicate membuat prompt mandiri dengan riwayat yang sama pada saat duplikasi. Rename mengarahkan fokus ke field judul, sedangkan judul ikut disimpan saat versi baru dibuat.

## Persiapan Integrasi Backend pada Milestone Berikutnya

Model lokal sudah memiliki `projectId`, identifier prompt, timestamps, dan snapshot versions agar mudah dipetakan ke resource REST/database. Integrasi berikutnya dapat mengganti adapter `readAll`/`persist` dengan repository async tanpa mengubah komponen editor dan fungsi filter/versioning.

Tahap backend sebaiknya menambahkan endpoint project-scoped, optimistic concurrency untuk versioning, validasi kategori/target server-side, autentikasi/otorisasi project, serta migrasi satu kali dari localStorage. Sampai integrasi tersebut dilakukan, tidak ada request jaringan yang dibuat oleh Prompt Studio.
