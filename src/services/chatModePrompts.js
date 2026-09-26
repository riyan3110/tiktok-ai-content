// Exact carousel prompts per chat mode (Default/Tutorial/Cerita/Berita), supplied
// by the user. The 🔍 menu selects a mode; the typed message is the TOPIC. We
// inject the matching full prompt (topic substituted) so the chat output follows
// the precise SLIDE 1–4 + CAPTION + TAGAR structure — not a loose paraphrase.
// Every mode is grounded server-side by a forced web search before answering.

const DEFAULT_PROMPT = `Cari informasi atau berita terbaru tentang topik berikut:

"{{TOPIC}}"

Pastikan informasi yang digunakan benar-benar aktual, relevan, dan bermanfaat.

WAJIB:
- Cari dan baca beberapa sumber tepercaya, jangan hanya mengandalkan satu artikel.
- Prioritaskan sumber resmi perusahaan atau organisasi, kemudian gunakan media tepercaya.
- Cocokkan fakta-fakta penting dari beberapa sumber.
- Jangan memasukkan rumor sebagai fakta.
- Jangan mengarang angka, fitur, fungsi, tanggal, kutipan, hasil, atau klaim yang tidak didukung sumber.
- Jika ada informasi yang belum pasti, jangan masukkan ke dalam konten.
- Gunakan informasi yang paling baru dan paling relevan dengan topik.
- Hindari pembahasan yang terlalu umum jika tersedia informasi baru yang lebih menarik.
- Gunakan bahasa Indonesia yang natural, jelas, padat, dan mudah dipahami.
- Jangan membuat tulisan yang terdengar seperti hasil AI.
- Hindari clickbait palsu, hiperbola, dan klaim sensasional.

Setelah informasi ditemukan dan diverifikasi, ringkas secara natural menjadi carousel 4 slide dengan struktur persis berikut:

SLIDE 1 - HOOK

[1 judul hook singkat, maksimal 10–12 kata.]

SLIDE 2 - FAKTA UTAMA

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat singkat yang menjelaskan fakta utama, maksimal 20–25 kata.]

• [1 poin penting, maksimal 12–16 kata]
• [1 poin penting, maksimal 12–16 kata]

SLIDE 3 - DETAIL

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat singkat yang menjelaskan detail lanjutan, maksimal 20–25 kata.]

• [1 detail penting, maksimal 12–16 kata]
• [1 detail penting, maksimal 12–16 kata]

SLIDE 4 - PENUTUP

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat penutup, maksimal 20–25 kata.]

CAPTION

[Ringkas isi carousel dalam tepat 2 kalimat, dengan total maksimal sekitar 40–50 kata.]

TAGAR

[5 hashtag yang paling relevan.]

ATURAN PENULISAN:
- Jangan menulis label tambahan selain struktur di atas.
- Slide 1 hanya berisi judul atau hook.
- Slide 2 wajib berisi 1 judul, tepat 1 kalimat body, dan tepat 2 bullet.
- Slide 3 wajib berisi 1 judul, tepat 1 kalimat body, dan tepat 2 bullet.
- Slide 4 wajib berisi 1 judul dan tepat 1 kalimat penutup.
- Bullet harus menambahkan informasi baru, bukan mengulang isi body.
- Setiap slide harus memiliki fungsi yang berbeda.
- Jangan mengulang fakta dengan susunan kata yang berbeda.
- Jangan memindahkan caption atau tagar ke dalam slide.
- Hindari judul generik seperti "Fakta Utama", "Detail Penting", "Informasi Utama", atau "Kesimpulan".
- Jangan memenuhi slide dengan terlalu banyak teks.
- Pertahankan nama produk, perusahaan, model, angka, tanggal, dan istilah teknis sesuai sumber.
- Jangan mengubah tingkat kepastian informasi dari sumber.
- Pastikan seluruh isi berasal dari informasi yang telah diperiksa.
- Jangan menambahkan pendapat pribadi.
- Jangan menampilkan daftar sumber, URL, sitasi, catatan, proses pencarian, atau penjelasan tambahan.
- Tidak ada elemen konsisten yang ditentukan.
- Tidak ada produk tertentu yang harus disebutkan.
- Tidak ada foto referensi.
- Jangan menyebutkan produk tertentu jika tidak relevan dengan topik.
- Keluarkan hanya SLIDE 1 sampai SLIDE 4, CAPTION, dan TAGAR.`;

const TUTORIAL_PROMPT = `Cari informasi terbaru dan tepercaya tentang topik berikut:

"{{TOPIC}}"

Pahami terlebih dahulu apakah topik tersebut memiliki proses, cara penggunaan, langkah, pengaturan, metode, atau urutan tindakan yang benar-benar didukung oleh sumber.

WAJIB:
- Cari dan baca beberapa sumber tepercaya.
- Prioritaskan dokumentasi resmi, halaman bantuan resmi, pengumuman perusahaan atau organisasi, kemudian media tepercaya.
- Cocokkan langkah, fitur, nama menu, fungsi, syarat, angka, dan batasan antar-sumber.
- Jangan menciptakan langkah yang tidak dinyatakan atau tidak dapat disimpulkan secara langsung dari sumber.
- Jangan mengarang tombol, menu, fitur, hasil, manfaat, atau urutan tindakan.
- Jika sumber tidak mendukung tutorial tindakan yang nyata, susun konten sebagai urutan penjelasan yang logis tanpa mengarang tindakan baru.
- Gunakan informasi terbaru yang tersedia.
- Gunakan bahasa yang natural, praktis, langsung, dan mudah diikuti.
- Hindari gaya tulisan seperti manual robot atau tulisan AI.
- Hindari kalimat panjang dan penjelasan yang berputar-putar.

Setelah informasinya diverifikasi, susun menjadi carousel tutorial 4 slide dengan struktur persis berikut:

SLIDE 1 - PEMBUKA

[1 judul yang menjelaskan apa yang akan dilakukan atau dipelajari, maksimal 10–12 kata.]

SLIDE 2 - LANGKAH 1

[1 judul langkah, maksimal 8–10 kata.]

[1 instruksi utama yang jelas, maksimal 18–22 kata.]

1. [Tindakan pendukung pertama, maksimal 10–12 kata]
2. [Tindakan pendukung kedua, maksimal 10–12 kata]

SLIDE 3 - LANGKAH 2

[1 judul langkah berikutnya, maksimal 8–10 kata.]

[1 instruksi utama berikutnya, maksimal 18–22 kata.]

1. [Tindakan pendukung pertama, maksimal 10–12 kata]
2. [Tindakan pendukung kedua, maksimal 10–12 kata]

SLIDE 4 - HASIL / PENUTUP

[1 judul hasil atau pengecekan akhir, maksimal 8–10 kata.]

[1 kalimat yang menjelaskan hasil, kondisi akhir, atau hal yang perlu diperiksa, maksimal 20–24 kata.]

CAPTION

[Ringkas tutorial dalam tepat 2 kalimat, maksimal sekitar 40–50 kata.]

TAGAR

[5 hashtag paling relevan.]

ATURAN PENULISAN:
- Pastikan tutorial benar-benar berurutan.
- Mulai langkah dari tahap yang paling masuk akal.
- Jangan membuat semua slide seperti daftar fakta.
- Slide 2 dan Slide 3 harus berisi tindakan atau tahap yang berbeda.
- Jangan mengulang instruksi yang sama dengan kata-kata berbeda.
- Nomor pada langkah merupakan bagian dari urutan proses, bukan dekorasi.
- Tindakan pendukung harus memperjelas instruksi utama, bukan mengulanginya.
- Jangan menambahkan langkah yang tidak didukung sumber hanya agar carousel terlihat lengkap.
- Jika sumber hanya menyediakan urutan penjelasan, jangan menyamarkannya sebagai tindakan pengguna.
- Jangan menjanjikan hasil yang tidak dijamin oleh sumber.
- Pertahankan nama tombol, menu, produk, model, versi, angka, dan istilah teknis sesuai sumber.
- Jangan mengubah kata "dapat" menjadi "pasti".
- Jangan menampilkan sumber, URL, sitasi, catatan, atau penjelasan tambahan.
- Elemen konsisten: tidak ada yang ditentukan.
- Produk: tidak ada. Jangan menyebut produk tertentu.
- Foto referensi: tidak ada.

Keluarkan hanya SLIDE 1 sampai SLIDE 4, CAPTION, dan TAGAR.`;

const CERITA_PROMPT = `Cari informasi atau berita terbaru tentang "{{TOPIC}}" dari beberapa sumber tepercaya, lalu pahami urutan kejadian dan konteksnya secara menyeluruh.

WAJIB:
- Cari dan baca beberapa sumber tepercaya.
- Prioritaskan sumber resmi dan laporan langsung, kemudian gunakan media tepercaya sebagai pembanding.
- Cocokkan fakta penting dan urutan kejadian antar-sumber.
- Jangan membuat tokoh, dialog, emosi, motif, konflik, sebab-akibat, atau kejadian yang tidak didukung oleh sumber.
- Jangan mendramatisasi fakta.
- Jangan menulis seolah-olah memiliki pengalaman pribadi.
- Jika urutan waktu tidak jelas dari sumber, jangan mengarang kronologi.
- Gunakan informasi terbaru yang tersedia.
- Gunakan bahasa yang natural, mengalir, ringan, dan nyaman dibaca.
- Pastikan setiap slide terasa sebagai kelanjutan dari slide sebelumnya.
- Jangan gunakan gaya laporan formal atau tulisan yang terdengar seperti dibuat AI.

Setelah informasi diverifikasi, susun menjadi carousel cerita 4 slide dengan struktur persis berikut:

SLIDE 1 - PEMBUKA CERITA

[Tulis 1 judul hook yang membuka cerita dengan maksimal 10–12 kata.]

SLIDE 2 - SITUASI

[Tulis 1 judul singkat dengan maksimal 8–10 kata.]

[Tulis 1 paragraf naratif singkat yang menjelaskan situasi awal dengan maksimal 30–35 kata.]

SLIDE 3 - PERKEMBANGAN

[Tulis 1 judul singkat dengan maksimal 8–10 kata.]

[Tulis 1 paragraf naratif singkat yang meneruskan kejadian, perubahan, atau fakta penting berikutnya dengan maksimal 30–35 kata.]

SLIDE 4 - PENYELESAIAN

[Tulis 1 judul singkat dengan maksimal 8–10 kata.]

[Tulis 1 paragraf penutup yang menjelaskan keadaan akhir, makna, atau posisi terbaru berdasarkan fakta dengan maksimal 30–35 kata.]

CAPTION

[Tulis ringkasan keseluruhan cerita dalam tepat 2 kalimat dengan panjang maksimal sekitar 40–50 kata.]

TAGAR

[Tulis 5 hashtag yang paling relevan.]

ATURAN PENULISAN:
- Jangan menggunakan bullet.
- Jangan menggunakan daftar bernomor.
- Setiap slide harus menjadi bagian dari satu cerita yang berkesinambungan.
- Slide 2 harus menjelaskan kondisi atau situasi awal.
- Slide 3 harus benar-benar melanjutkan perkembangan, bukan mengulang isi Slide 2.
- Slide 4 harus menjadi penyelesaian atau menjelaskan posisi terakhir yang diketahui.
- Gunakan transisi secara natural hanya jika sesuai dengan fakta.
- Jangan menambahkan kata seperti "akhirnya", "kemudian", "karena itu", atau "akibatnya" jika hubungan tersebut tidak didukung oleh sumber.
- Jangan membuat drama, konflik, perasaan, atau motivasi buatan.
- Jangan mengulang informasi yang sama untuk memenuhi jumlah slide.
- Judul harus membantu membangun alur cerita, bukan menjadi label generik.
- Hindari judul seperti "Situasi Awal", "Perkembangan Cerita", atau "Kesimpulan".
- Pertahankan nama, angka, tanggal, produk, perusahaan, dan istilah teknis sesuai sumber.
- Jangan mengubah tingkat kepastian informasi.
- Jangan menambahkan opini pribadi.
- Jangan menampilkan sumber, URL, sitasi, catatan, atau proses pencarian.
- Tidak ada elemen konsisten yang ditentukan.
- Tidak ada produk tertentu yang perlu disebutkan.
- Tidak ada foto referensi.
- Jangan menyebut produk tertentu jika tidak relevan dengan topik.
- Keluarkan hanya bagian SLIDE 1 sampai SLIDE 4, CAPTION, dan TAGAR.
- Jangan menambahkan penjelasan apa pun di luar format tersebut.`;

const BERITA_PROMPT = `Cari berita terbaru tentang "{{TOPIC}}" yang benar-benar aktual, penting, dan memiliki informasi baru.

WAJIB:
- Cari dan baca beberapa sumber tepercaya.
- Prioritaskan sumber resmi perusahaan, organisasi, lembaga, pemerintah, dokumen resmi, kemudian media tepercaya.
- Cocokkan fakta penting dari berbagai sumber.
- Pastikan tanggal, angka, nama, status, pernyataan, dan perkembangan terakhir tidak saling bertentangan.
- Jangan memasukkan rumor, bocoran tanpa konfirmasi, atau spekulasi sebagai fakta.
- Jangan mengarang kutipan, angka, fitur, alasan, dampak, motif, atau prediksi.
- Jika informasi masih belum pasti, jangan masukkan informasi tersebut.
- Utamakan perkembangan paling baru.
- Bedakan fakta utama, konteks, dan perkembangan terbaru.
- Gunakan bahasa Indonesia yang netral, natural, jelas, dan ringkas.
- Hindari opini, bahasa promosi, dramatisasi, dan clickbait.

Setelah berita diverifikasi, susun menggunakan pola PIRAMIDA TERBALIK menjadi carousel berita 4 slide dengan STRUKTUR PERSIS berikut:

SLIDE 1 - HEADLINE

[1 headline berita yang langsung menyampaikan inti paling penting, maksimal 10–12 kata.]

SLIDE 2 - FAKTA UTAMA

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat ringkasan fakta terpenting, maksimal 20–25 kata.]

FAKTA 1 — [fakta pendukung pertama, maksimal 12–16 kata]
FAKTA 2 — [fakta pendukung kedua, maksimal 12–16 kata]

SLIDE 3 - KONTEKS / DETAIL

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat yang memberikan konteks atau detail lanjutan, maksimal 20–25 kata.]

FAKTA 1 — [detail pendukung pertama, maksimal 12–16 kata]
FAKTA 2 — [detail pendukung kedua, maksimal 12–16 kata]

SLIDE 4 - PERKEMBANGAN

[1 judul singkat, maksimal 8–10 kata.]

[1 kalimat yang menjelaskan perkembangan terbaru, status saat ini, atau hal berikutnya yang diketahui, maksimal 20–25 kata.]

CAPTION

[Ringkas berita dalam tepat 2 kalimat, maksimal sekitar 40–50 kata.]

TAGAR

[5 hashtag paling relevan.]

ATURAN PENULISAN:
- Tempatkan informasi terpenting di bagian paling awal.
- Headline harus menyampaikan inti berita, bukan teaser kosong.
- Jangan membuat headline berupa pertanyaan jika fakta utama sudah diketahui.
- Slide 2 harus berisi fakta inti tentang apa yang benar-benar terjadi.
- Slide 3 harus memberikan konteks, detail, angka, latar belakang, atau penjelasan yang relevan.
- Slide 4 harus berisi perkembangan terbaru atau status terakhir yang didukung sumber.
- Jangan menggunakan gaya cerita dramatis.
- Jangan menggunakan urutan tutorial.
- FAKTA 1 dan FAKTA 2 harus menjadi informasi pendukung, bukan pengulangan isi utama.
- Jangan membuat prediksi tentang apa yang akan terjadi, kecuali sumber resmi memang menyatakannya.
- Bedakan istilah "direncanakan", "diumumkan", "diperkenalkan", "diluncurkan", dan "tersedia".
- Jangan mengubah kata "dapat", "mungkin", atau "diperkirakan" menjadi kepastian.
- Hindari atribusi berlebihan seperti "perusahaan menegaskan" jika sumber hanya menjelaskan fakta.
- Pertahankan nama, angka, tanggal, model, perusahaan, wilayah, dan istilah teknis sesuai sumber.
- Jangan menambahkan pendapat pribadi.
- Jangan menampilkan daftar sumber, URL, sitasi, catatan, atau proses verifikasi.
- Elemen konsisten: tidak ada yang ditentukan.
- Produk: tidak ada. Jangan menyebut produk tertentu.
- Foto referensi: tidak ada.
- Keluarkan hanya SLIDE 1 sampai SLIDE 4, CAPTION, dan TAGAR.`;

// Map chat menu mode id -> full prompt. 'pencarian' has no template (plain answer).
const MODE_PROMPTS = {
  default: DEFAULT_PROMPT,
  tutorial: TUTORIAL_PROMPT,
  story: CERITA_PROMPT,
  news: BERITA_PROMPT
};

// Return the full carousel prompt for a menu mode with the topic substituted, or
// '' for 'pencarian'/unknown (plain grounded answer). The returned prompt is the
// COMPLETE instruction; the caller should send it as the user message body.
function chatModePrompt(mode, topic) {
  const id = String(mode || '').trim().toLowerCase();
  const template = MODE_PROMPTS[id];
  if (!template) return '';
  const filled = template.replace(/\{\{TOPIC\}\}/g, String(topic || '').trim());
  // Hard rule appended to every mode: plain text only, no markdown symbols.
  const noMarkdown = '\n\nPENTING: Tulis output sebagai teks polos. JANGAN gunakan format markdown atau simbol apa pun seperti tanda bintang (*), pagar (#), garis bawah (_), atau backtick (`) untuk menebalkan/memiringkan teks. Tulis label slide apa adanya tanpa tanda bintang.';
  return filled + noMarkdown;
}

module.exports = { chatModePrompt, MODE_PROMPTS };
