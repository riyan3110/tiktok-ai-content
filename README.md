# TikTok AI Content

Aplikasi Node.js 20 untuk membuat konten carousel berbahasa Indonesia dengan **Gemini, Groq, atau OpenAI**, merender tiga gambar 1080×1920 dengan Sharp, dan mengunggah photo post sebagai draft melalui **TikTok Content Posting API**.

## Fitur dan struktur

- Dashboard responsif: pilih topik manual, otomatis dari AI, atau trending; generate, preview, edit caption, upload, status, dan riwayat berlabel sumber topik.
- Structured Output berisi topik, hook, tutorial, caption, hashtag, dan CTA; hingga 50 topik terakhir dikirim ke model untuk mencegah pengulangan.
- Slide tersimpan sebagai JPEG RGB/sRGB 1080 x 1920 di `public/generated/`; metadata dan token OAuth disimpan di SQLite.
- Scheduler `node-cron` opsional hanya membuat draft konten lokal, **tidak mengunggah otomatis**.
- Topik dibandingkan tanpa membedakan kapital dan spasi berlebih. Mode AI/trending mencoba ulang maksimal tiga kali agar `UNIQUE` topic tetap aman.

```text
database/schema.sql        skema SQLite
nginx/                     contoh reverse proxy
public/                    dashboard dan hasil gambar
src/app.js                 route Express
src/services/              AI, Sharp, dan TikTok
src/server.js              server serta cron
test/                      integration test
ecosystem.config.cjs       konfigurasi PM2
```

## Instalasi lokal

1. Pasang Node.js 20, lalu jalankan `npm install`.
2. Salin `cp .env.example .env`, isi kredensial, dan buat `SESSION_SECRET` dengan `openssl rand -hex 32`.
3. Pastikan `PUBLIC_BASE_URL` merupakan origin HTTPS publik. TikTok harus dapat mengambil URL gambar di `/generated/...`.
4. Jalankan `npm start`, kemudian buka `http://localhost:3000`.

## Konfigurasi penyedia AI

Aplikasi menggunakan library OpenAI JavaScript dan endpoint kompatibel OpenAI. Empat variable berikut wajib diisi; aplikasi akan menampilkan pesan yang menyebut variable yang belum lengkap atau provider yang tidak didukung:

```dotenv
AI_PROVIDER=gemini
AI_API_KEY=masukkan-api-key
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_MODEL=gemini-2.5-flash-lite
```

Pilih salah satu konfigurasi berikut. Model contoh merupakan model ringan; apabila penyedia menghentikan suatu model, ganti `AI_MODEL` dengan model aktif yang tersedia pada akun Anda.

| Provider | `AI_PROVIDER` | `AI_BASE_URL` | Contoh `AI_MODEL` |
|---|---|---|---|
| Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash-lite` |
| Groq | `groq` | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4.1-mini` |

Gunakan API key dari provider yang dipilih. Aplikasi meminta JSON Object melalui Chat Completions API, menyertakan schema dalam prompt, lalu memvalidasi hasilnya, sehingga struktur topik, hook, body, caption, hashtag, dan CTA tetap sama untuk semua provider. Jangan commit `.env` atau API key.

## Sumber topik dan trending

Pada dashboard, pilih salah satu **Sumber Topik** sebelum membuat konten:

- **Topik manual** mewajibkan input pengguna. AI boleh membuat judul lebih menarik, tetapi prompt mengharuskannya mempertahankan inti topik. Input asli disimpan di `requested_topic`.
- **Otomatis dari AI** memilih topik baru dan membandingkannya dengan riwayat secara case-insensitive serta mengabaikan spasi berlebih.
- **Topik trending** mengambil daftar terbaru dari endpoint opsional, menyaring topik yang relevan dengan tutorial AI, video iklan, UGC, editing, konten kreator, TikTok, Canva, dan tools AI. Jika endpoint kosong atau gagal, AI membuat fallback tren berdasarkan tanggal saat ini.

Endpoint trending boleh mengembalikan array langsung atau array pada field `topics`, `data`, atau `results`; setiap item dapat berupa string atau object dengan `topic`, `title`, atau `name`.

```dotenv
TRENDING_API_URL=https://trending.example.com/topics
TRENDING_API_KEY=key-opsional
```

Untuk pembuatan terjadwal, atur sumber dengan nilai `manual`, `ai`, atau `trending`. Mode manual juga membutuhkan topik:

```dotenv
DAILY_TOPIC_MODE=ai
DAILY_MANUAL_TOPIC=
```

## Menghubungkan TikTok OAuth 2.0

1. Buat aplikasi di TikTok for Developers, tambahkan produk **Login Kit** dan **Content Posting API**, lalu aktifkan scope `user.info.basic` dan `video.upload`.
2. Daftarkan URL redirect yang **persis sama** dengan `TIKTOK_REDIRECT_URI`, misalnya `https://konten.example.com/auth/tiktok/callback`.
3. Isi client key/secret di `.env`, restart aplikasi, lalu tekan **Hubungkan TikTok**.
4. Token disimpan di database lokal dan di-refresh otomatis. Lindungi server dan backup database karena token adalah data rahasia.

Implementasi ini menggunakan **Upload to TikTok** (`MEDIA_UPLOAD`) untuk membuat draft, bukan Direct Post. Pengguna menyelesaikan proses posting di TikTok. Domain/URL media juga perlu diverifikasi pada konfigurasi Content Posting API. UI dan caption tetap harus mematuhi pedoman developer serta kebijakan TikTok.

## Menguji upload draft

1. Gunakan akun TikTok tester/sandbox yang diizinkan pada aplikasi developer dan selesaikan OAuth.
2. Klik **Buat konten baru**, periksa semua slide, dan edit caption bila perlu.
3. Klik **Upload draft ke TikTok**. Respons awal memberi `publishId`.
4. Klik **Cek status** sampai upload selesai atau lihat alasan kegagalan, lalu lanjutkan proses posting draft di aplikasi TikTok.

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
| POST | `/generate` | Generate konten serta gambar; body `{topicSource, requestedTopic?}` |
| POST | `/upload-tiktok` | Body `{id, caption}`; unggah sebagai draft |
| GET | `/status/:publishId` | Ambil status TikTok |
| GET | `/history` | Riwayat konten JSON |

## Pemeriksaan

Jalankan `npm run check` dan `npm test`. File database, gambar hasil generate, dependency, dan semua secret diabaikan Git.
