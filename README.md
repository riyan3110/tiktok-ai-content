# TikTok AI Content

Aplikasi Node.js 20 untuk membuat konten carousel berbahasa Indonesia dengan **OpenAI Responses API**, merender tiga gambar 1080×1920 dengan Sharp, dan mengirim photo post ke **TikTok Content Posting API** dalam visibilitas `SELF_ONLY` (privat).

## Fitur dan struktur

- Dashboard responsif: generate, preview, edit caption, upload, status, dan riwayat.
- Structured Output berisi topik, hook, tutorial, caption, hashtag, dan CTA; hingga 50 topik terakhir dikirim ke model untuk mencegah pengulangan.
- Gambar tersimpan di `public/generated/`; metadata dan token OAuth disimpan di SQLite.
- Scheduler `node-cron` opsional hanya membuat draft konten lokal, **tidak mengunggah otomatis**.

```text
database/schema.sql        skema SQLite
nginx/                     contoh reverse proxy
public/                    dashboard dan hasil gambar
src/app.js                 route Express
src/services/              OpenAI, Sharp, dan TikTok
src/server.js              server serta cron
test/                      integration test
ecosystem.config.cjs       konfigurasi PM2
```

## Instalasi lokal

1. Pasang Node.js 20, lalu jalankan `npm install`.
2. Salin `cp .env.example .env`, isi kredensial, dan buat `SESSION_SECRET` dengan `openssl rand -hex 32`.
3. Pastikan `PUBLIC_BASE_URL` merupakan origin HTTPS publik. TikTok harus dapat mengambil URL gambar di `/generated/...`.
4. Jalankan `npm start`, kemudian buka `http://localhost:3000`.

## Konfigurasi OpenAI

Buat API key di proyek OpenAI dan isi `OPENAI_API_KEY`. Model dapat diganti lewat `OPENAI_MODEL`. Aplikasi memakai Responses API dengan JSON Schema agar output konsisten. Jangan commit `.env`.

## Menghubungkan TikTok OAuth 2.0

1. Buat aplikasi di TikTok for Developers, tambahkan produk **Login Kit** dan **Content Posting API**, lalu ajukan/aktifkan scope `user.info.basic`, `video.upload`, dan `video.publish` sesuai akses aplikasi Anda.
2. Daftarkan URL redirect yang **persis sama** dengan `TIKTOK_REDIRECT_URI`, misalnya `https://konten.example.com/auth/tiktok/callback`.
3. Isi client key/secret di `.env`, restart aplikasi, lalu tekan **Hubungkan TikTok**.
4. Token disimpan di database lokal dan di-refresh otomatis. Lindungi server dan backup database karena token adalah data rahasia.

TikTok mewajibkan audit untuk Direct Post publik. Implementasi ini sengaja menetapkan `privacy_level: SELF_ONLY`; kode tidak menyediakan opsi publik. Domain/URL media juga perlu diverifikasi pada konfigurasi Content Posting API. UI dan caption tetap harus mematuhi pedoman developer serta kebijakan TikTok.

## Menguji upload privat

1. Gunakan akun TikTok tester/sandbox yang diizinkan pada aplikasi developer dan selesaikan OAuth.
2. Klik **Buat konten baru**, periksa semua slide, dan edit caption bila perlu.
3. Klik **Kirim privat ke TikTok**. Respons awal memberi `publishId`.
4. Klik **Cek status** sampai `PUBLISH_COMPLETE` atau lihat alasan kegagalan. Periksa post dengan visibilitas **Only you** di aplikasi TikTok. Jangan mengubah `SELF_ONLY` sebelum aplikasi lolos audit dan pengguna secara eksplisit memilih visibilitas.

## Instalasi VPS (Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
git clone <URL_REPOSITORY> /var/www/tiktok-ai-content
cd /var/www/tiktok-ai-content
npm ci --omit=dev
cp .env.example .env && nano .env
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
sudo cp nginx/tiktok-ai-content.conf /etc/nginx/sites-available/tiktok-ai-content
sudo ln -s /etc/nginx/sites-available/tiktok-ai-content /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d konten.example.com
```

Ganti `server_name` dan nilai `.env`; batasi izin `.env` (`chmod 600 .env`). Karena PM2 berjalan satu instance, SQLite dan session memory aman untuk deployment sederhana. Untuk beberapa instance, gunakan session store bersama dan database server.

## Endpoint

| Method | Path | Kegunaan |
|---|---|---|
| GET | `/auth/tiktok` | Mulai OAuth |
| GET | `/auth/tiktok/callback` | Callback dan penyimpanan token |
| POST | `/generate` | Generate konten serta gambar |
| POST | `/upload-tiktok` | Body `{id, caption}`; unggah privat |
| GET | `/status/:publishId` | Ambil status TikTok |
| GET | `/history` | Riwayat konten JSON |

## Pemeriksaan

Jalankan `npm run check` dan `npm test`. File database, gambar hasil generate, dependency, dan semua secret diabaikan Git.
