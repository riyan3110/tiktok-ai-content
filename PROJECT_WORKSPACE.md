# Project Workspace — Milestone 2

## Struktur Workspace

Project Workspace menjadi pintu masuk utama AI Ads Lab tanpa menggantikan Content Studio yang telah ada. Navigasi utama menyediakan **Projects**, **Templates**, **Prompt Library**, **Assets**, **Analytics**, dan **Settings**. Content Studio, Referensi Tren, Jadwal, serta Riwayat tetap tersedia di bagian navigasi legacy agar seluruh workflow lama tetap dapat digunakan.

Data project milestone ini disimpan di `localStorage` browser dengan key `ai-ads-lab-projects-v1`. Pendekatan frontend-only ini sengaja dipilih agar API, database, konfigurasi environment, proses PM2, dan integrasi TikTok yang sedang berjalan tidak berubah.

## Alur Project

1. Pengguna membuka halaman **Projects** dan melihat daftar seluruh project.
2. Pengguna dapat mencari berdasarkan nama project, brand, atau produk serta memfilter status, kategori, brand, dan tanggal dibuat.
3. Dari tombol **Create Project**, pengguna mengisi nama project, brand, produk, kategori, dan deskripsi.
4. Project baru dibuat dengan status `Draft`, jumlah Prompt `0`, dan jumlah Storyboard `0`.
5. Memilih card membuka halaman detail project yang memuat metadata dan struktur ruang kerja produksi.
6. Tombol **Buka Content Studio** membawa pengguna ke generator lama tanpa mengubah workflow generator tersebut.

## Komponen yang Ditambahkan

- Dashboard project responsif dengan card, thumbnail generatif, status, metadata waktu, dan jumlah konten.
- Empty state untuk workspace baru serta no-result state untuk pencarian/filter.
- Dialog Create Project dengan validasi field wajib dan penghitung karakter deskripsi.
- Toolbar pencarian dan panel filter yang dapat dibuka/tutup.
- Detail Project dengan area Storyboards, Prompt, Character, Product, Image, Video, Voice, Assets, Notes, dan Riwayat.
- Placeholder terarah untuk modul navigasi yang belum diaktifkan.
- Persistensi project lokal yang terisolasi dari backend lama.

## Persiapan Milestone Berikutnya

Struktur modul di halaman detail sudah memisahkan domain produksi konten sehingga dapat dihubungkan secara bertahap ke model data dan API project di milestone berikutnya. Sebelum sinkronisasi server dilakukan, perlu ditentukan skema relasi project dengan prompt, storyboard, character, product, media, voice, assets, notes, dan history; strategi autentikasi/ownership; migrasi data lokal; serta aturan status dan thumbnail. Generator lama dapat diintegrasikan melalui `project_id` setelah kontrak API baru tersedia, tanpa memutus endpoint yang ada.
