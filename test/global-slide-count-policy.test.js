const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { validateSlides } = require('../src/services/content');

function slides(count, format) {
  if (format === 'Masalah dan solusi') {
    const values = [
      { section: 'MASALAH', title: 'Masalah utama', body: 'Masalah perlu dipahami dengan jelas.', points: [] },
      { section: 'SOLUSI', title: 'Solusi pertama', body: 'Tindakan pertama dibuat secara spesifik.', points: [] },
      { section: 'SOLUSI', title: 'Solusi kedua', body: 'Tindakan kedua melengkapi solusi pertama.', points: [] },
      { section: 'PENUTUP', title: 'Hasil yang dituju', body: 'Tutup dengan hasil yang relevan.', points: [] },
      { section: 'SOLUSI', title: 'Solusi tambahan', body: 'Tambahkan bila memang masih dibutuhkan.', points: [] },
      { section: 'PENUTUP', title: 'Penutup tambahan', body: 'Isi tambahan untuk menguji batas maksimum.', points: [] }
    ];
    return values.slice(0, count);
  }
  if (format === 'Tutorial langkah') {
    const values = [
      { section: 'PEMBUKA', title: 'Mulai dari tujuan', body: 'Tentukan hasil yang ingin dicapai.', points: [] },
      { section: 'LANGKAH 1', title: 'Siapkan bahan utama', body: '', points: ['1. Siapkan bahan yang diperlukan'] },
      { section: 'LANGKAH 2', title: 'Kerjakan tahap berikut', body: '', points: ['2. Jalankan proses sesuai urutan'] },
      { section: 'PENUTUP', title: 'Periksa hasil akhirnya', body: 'Pastikan hasil sesuai tujuan awal.', points: [] },
      { section: 'LANGKAH 3', title: 'Tambahkan tahap opsional', body: '', points: ['3. Tambahkan bila memang dibutuhkan'] },
      { section: 'PENUTUP', title: 'Penutup tambahan', body: 'Isi tambahan untuk menguji batas maksimum.', points: [] }
    ];
    return values.slice(0, count);
  }
  return Array.from({ length: count }, (_, index) => ({
    section: index === 0 ? 'PEMBUKA' : index === count - 1 ? 'PENUTUP' : `POIN ${index}`,
    title: `Judul berbeda ${index + 1}`,
    body: `Isi berbeda untuk slide nomor ${index + 1}.`,
    points: []
  }));
}

for (const format of ['Fakta singkat', 'Masalah dan solusi', 'Tutorial langkah', 'Listicle']) {
  test(`${format}: tiga slide selalu ditolak dan empat sampai lima diterima`, () => {
    const three = validateSlides(slides(3, format), { format, validateCopy: false });
    assert.ok(three.some(error => /minimal 4 slide/i.test(error)));

    const four = validateSlides(slides(4, format), { format, validateCopy: false });
    assert.ok(!four.some(error => /minimal 4 slide|maksimal 5 slide/i.test(error)));

    const five = validateSlides(slides(5, format), { format, validateCopy: false });
    assert.ok(!five.some(error => /minimal 4 slide|maksimal 5 slide/i.test(error)));

    const six = validateSlides(slides(6, format), { format, validateCopy: false });
    assert.ok(six.some(error => /maksimal 5 slide/i.test(error)));
  });
}
