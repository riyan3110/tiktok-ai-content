const test = require('node:test');
const assert = require('node:assert/strict');

const fit = require('../src/services/autoSourceVisualFit');

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

test('long factual body is compacted before the shared four-line renderer gate', () => {
  const body = 'Google menghadirkan fitur Ask Maps yang memungkinkan pengguna mengajukan pertanyaan kompleks tentang tempat lalu memperoleh jawaban berdasarkan informasi lokasi yang tersedia di Google Maps.';
  const compact = fit.compactCopy(body, {
    maxWords: fit.BODY_MAX_WORDS,
    maxChars: fit.BODY_MAX_CHARS,
    minimum: 7,
    sentence: true
  });
  assert.ok(countWords(compact) <= fit.BODY_MAX_WORDS);
  assert.ok(compact.length <= fit.BODY_MAX_CHARS + 1);
  assert.ok(body.startsWith(compact.replace(/[.!?]$/, '')));
});

test('Auto Source visual fit keeps source/evidence metadata while syncing visible copy', () => {
  const evidence = 'Google menghadirkan fitur Ask Maps yang memungkinkan pengguna mengajukan pertanyaan kompleks tentang tempat lalu memperoleh jawaban berdasarkan informasi lokasi yang tersedia di Google Maps.';
  const content = {
    sourceMode: 'auto',
    hook: 'Ask Maps',
    body: evidence,
    caption: evidence,
    cta: 'Ask Maps',
    slides: [{
      title: 'Google menghadirkan Ask Maps untuk pencarian tempat yang lebih interaktif dan kontekstual',
      body: evidence,
      points: ['Pengguna dapat menanyakan banyak detail lokasi sekaligus melalui pengalaman percakapan di Google Maps'],
      claims: [
        { field: 'slide:0:body', text: evidence, sourceId: 'source-1', evidence },
        { field: 'slide:0:point:0', text: 'Pengguna dapat menanyakan banyak detail lokasi sekaligus melalui pengalaman percakapan di Google Maps', sourceId: 'source-1', evidence }
      ]
    }]
  };

  const result = fit.fitAutoSourceContent(content);
  const slide = result.slides[0];
  assert.ok(countWords(slide.title) <= fit.TITLE_MAX_WORDS);
  assert.ok(countWords(slide.body) <= fit.BODY_MAX_WORDS);
  assert.ok(slide.body.length <= fit.BODY_MAX_CHARS + 1);
  assert.ok(countWords(slide.points[0]) <= fit.POINT_MAX_WORDS);
  assert.equal(slide.claims[0].text, slide.body);
  assert.equal(slide.claims[0].sourceId, 'source-1');
  assert.equal(slide.claims[0].evidence, evidence);
  assert.equal(slide.claims[1].text, slide.points[0]);
  assert.equal(slide.claims[1].evidence, evidence);
});

test('Auto Source visual fit drops FAQ and bullets that would become dangling fragments', () => {
  const evidence = 'The detected watermark only indicates that supported Claude content contains a machine-readable signal.';
  const content = {
    sourceMode: 'auto',
    topic: 'Cloude menerapkan watermark',
    caption: 'Claude memakai watermark tak terlihat. Alat deteksi akan tersedia kemudian.',
    slides: [{
      title: 'Batas arti watermark',
      body: 'Watermark hanya menjadi sinyal yang dapat dibaca mesin.',
      points: [
        'Tanda air yang terdeteksi hanya menunjukkan bahwa konten tersebut memiliki sinyal asal tertentu',
        'FAQ: Apakah watermark Claude terlihat?',
        'Metadata C2PA menandai file gambar'
      ],
      claims: [
        { field: 'slide:0:body', text: 'Watermark hanya menjadi sinyal yang dapat dibaca mesin.', sourceId: 'source-1', evidence },
        { field: 'slide:0:point:0', text: 'Tanda air yang terdeteksi hanya menunjukkan bahwa konten tersebut memiliki sinyal asal tertentu', sourceId: 'source-1', evidence },
        { field: 'slide:0:point:1', text: 'FAQ: Apakah watermark Claude terlihat?', sourceId: 'source-1', evidence },
        { field: 'slide:0:point:2', text: 'Metadata C2PA menandai file gambar', sourceId: 'source-1', evidence: 'Supported image files use C2PA provenance metadata.' }
      ]
    }]
  };

  const result = fit.fitAutoSourceContent(content);
  assert.deepEqual(result.slides[0].points, ['Metadata C2PA menandai file gambar']);
  const pointClaim = result.slides[0].claims.find(claim => claim.field === 'slide:0:point:0');
  assert.equal(pointClaim?.text, 'Metadata C2PA menandai file gambar');
  assert.equal(pointClaim?.evidence, 'Supported image files use C2PA provenance metadata.');
});

test('non-Auto-Source content is exact pass-through', () => {
  const content = { sourceMode: 'url', slides: [{ title: 'Tetap', body: 'Tidak boleh diubah', points: [] }] };
  assert.strictEqual(fit.fitAutoSourceContent(content), content);
});
