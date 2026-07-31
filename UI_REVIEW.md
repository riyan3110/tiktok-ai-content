# UI Review — Milestone 1

## Ringkasan

Milestone ini memodernisasi antarmuka frontend AI Ads Lab tanpa mengubah alur bisnis, kontrak API, endpoint backend, database, environment, PM2, atau integrasi Hermes AI. Arah visual baru menggunakan workspace profesional dengan hierarki yang lebih jelas, dark mode sebagai default, dan light mode opsional.

## Perubahan UI

- App shell baru dengan sidebar persisten di desktop dan drawer di mobile.
- Header ringkas berisi konteks workspace, kontrol tema, dan status koneksi TikTok.
- Hero dashboard memperjelas alur utama **Ide → Preview → Draft**.
- Token design system konsisten untuk warna, surface, border, tipografi, spacing, radius, focus ring, tombol, dan form.
- Layout card serta hierarki section diperbarui agar proses membuat konten lebih mudah dipindai.
- Dark mode digunakan secara default. Pilihan light mode disimpan secara lokal di browser (`localStorage`), tanpa server atau database.
- Loading, empty, dan error state dibuat eksplisit untuk riwayat dan jadwal.
- Transisi hover/focus ringan, loading spinner, smooth scrolling, serta dukungan `prefers-reduced-motion`.
- Responsivitas ditingkatkan untuk mobile, tablet, desktop, dan layar lebar.

## Komponen Baru

1. **App Shell** — sidebar, mobile backdrop, dan area konten utama.
2. **Sidebar Navigation** — shortcut ke Content Studio, Referensi Tren, Jadwal, dan Riwayat.
3. **Top Bar** — menu mobile, identitas workspace, theme toggle, dan koneksi TikTok.
4. **Theme Toggle** — dark/light theme berbasis CSS custom properties.
5. **UI State** — loading spinner, empty state, dan error state yang dapat digunakan ulang.
6. **Hero / Workflow Summary** — konteks singkat untuk mempercepat orientasi pengguna.
7. **Section Kicker** — penanda urutan Create, Schedule, dan Library.

## Halaman yang Diperbarui

- `/` — dashboard utama, generator, referensi tren, preview, jadwal otomatis, dan riwayat.
- Halaman legal tetap kompatibel dengan style global dan routing lama.

## Screenshot Checklist

- [ ] Desktop dark mode.
- [ ] Mobile dark mode dan sidebar drawer.
- [ ] Desktop light mode.
- [ ] Loading state.
- [ ] Empty state.
- [ ] Error state dengan kegagalan API nyata (perlu simulasi service/network failure).
- [ ] Form generator, jadwal, preview, dan riwayat tetap dapat diakses.

Screenshot belum direkam karena container tidak menyediakan browser/headless browser. Checklist dapat dilanjutkan pada review PR di environment preview.

## Catatan Kompatibilitas

- Seluruh ID elemen yang digunakan oleh JavaScript lama dipertahankan.
- Seluruh request frontend tetap memakai endpoint, method, header, dan payload yang sama.
- Tidak ada perubahan pada backend, database/schema, konfigurasi proses, environment, maupun Hermes AI.
- Preferensi tema hanya disimpan di browser; dark mode tetap menjadi fallback default.
- Drawer mobile dapat ditutup lewat backdrop atau setelah memilih navigasi.
- Browser dengan dukungan CSS custom properties, grid, dan native `dialog` memperoleh pengalaman penuh.
- Pengguna yang memilih reduced motion tidak menerima animasi/transisi yang tidak perlu.
