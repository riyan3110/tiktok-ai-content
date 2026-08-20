const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function setup(overrides = {}) {
  const db = createDatabase(':memory:');
  const content = overrides.content || { generateContent: async (topics, options) => ({ topic: options.requestedTopic || (topics.length ? 'Topik Baru' : 'Storyboard AI'), hook: 'Hook kuat', body: '1. Tulis brief\n2. Buat visual', caption: 'Coba cara ini', hashtags: ['#AIAds'], cta: 'Simpan dan ikuti' }) };
  const images = overrides.images || { createSlides: async (id) => [`/generated/${id}-1.jpg`, `/generated/${id}-2.jpg`, `/generated/${id}-3.jpg`], validateSlides: async () => {} };
  const tiktok = overrides.tiktok || { randomState: () => 'state', authorizationUrl: () => 'https://example.com/oauth', validateImageUrls: async () => {}, publishPhotos: async () => ({ data: { publish_id: 'pub-1' } }), status: async () => ({ data: { status: 'SEND_TO_USER_INBOX' } }) };
  return { db, app: createApp({ db, content, images, tiktok, trending: overrides.trending || { getLatest: async () => [] }, sourceFetcher: overrides.sourceFetcher }) };
}
test('generate menyimpan struktur konten dan tiga slide', async () => { const { app } = setup(); const r = await request(app).post('/generate').send({ topicSource: 'ai' }).expect(200); assert.equal(r.body.topic, 'Storyboard AI'); assert.equal(r.body.topic_source, 'ai'); assert.equal(r.body.slides.length, 3); assert.deepEqual(r.body.hashtags, ['#AIAds']); });
test('topik manual wajib dipakai dan disimpan bersama sumber serta input asli', async () => { const { app } = setup(); const r = await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: '  Tutorial   sepatu AI  ' }).expect(200); assert.equal(r.body.topic, 'Tutorial sepatu AI'); assert.equal(r.body.requested_topic, 'Tutorial sepatu AI'); assert.equal(r.body.topic_source, 'manual'); });
test('topik manual yang sama dapat dibuat ulang sebagai konten baru', async () => {
  const { app, db } = setup();
  const payload = { topicSource: 'manual', requestedTopic: 'Cloude menerapkan watermark' };
  const first = await request(app).post('/generate').send(payload).expect(200);
  const repeated = await request(app).post('/generate').send(payload).expect(200);

  assert.notEqual(repeated.body.id, first.body.id);
  assert.equal(repeated.body.topic, payload.requestedTopic);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contents WHERE requested_topic=?').get(payload.requestedTopic).count, 2);
});
test('topik manual kosong ditolak', async () => { const { app } = setup(); await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: ' ' }).expect(400); });

test('useSources manual tanpa URL menghasilkan 400 dan proses lama tetap tanpa sumber', async () => {
  let options; const content = { generateContent: async (topics, value) => { options = value; return { topic: value.requestedTopic, hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } };
  const { app } = setup({ content });
  await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Tema', useSources: true, sourceUrls: [] }).expect(400);
  await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Tema', useSources: false, sourceUrls: [] }).expect(200);
  assert.equal(options.useSources, false);
  assert.deepEqual(options.sources, []);
});

test('sumber URL dikirim sebagai SOURCE_CONTEXT dan metadata tersimpan', async () => {
  let options; const fetchedAt = new Date().toISOString();
  let receivedUrls; const sourceFetcher = { validateSourceUrls: urls => [...new Set(urls)], fetchSources: async urls => { receivedUrls = urls; return [{ url: urls[0], finalUrl: urls[0], title: 'Dokumen', text: 'Teks sumber bersih yang panjang dan relevan.', fetchedAt }]; }, buildSourceContext: sources => `SOURCE 1\nTITLE: ${sources[0].title}\nURL: ${sources[0].url}\nCONTENT:\n${sources[0].text}` };
  const content = { generateContent: async (topics, value) => { options = value; return { topic: value.requestedTopic, hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } };
  const { app } = setup({ content, sourceFetcher });
  const r = await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Tema sumber', useSources: true, sourceUrls: ['https://example.com/a','https://example.com/a'] }).expect(200);
  assert.deepEqual(receivedUrls, ['https://example.com/a']);
  assert.equal(options.useSources, true);
  assert.match(options.sourceContext, /SOURCE 1/);
  assert.match(options.sourceContext, /Teks sumber bersih/);
  assert.equal(r.body.render_source.verificationStatus, 'source_based');
  assert.equal(r.body.render_source.sourceCount, 1);
  assert.equal(r.body.render_source.sources[0].title, 'Dokumen');
});

test('draft needs_review dari sumber tetap dikembalikan sebagai 200, bukan 422', async () => {
  const sourceFetcher = { validateSourceUrls: urls => urls, fetchSources: async urls => [{ url: urls[0], finalUrl: urls[0], title: 'Sumber terbatas', text: 'Sumber ini hanya memuat satu fakta yang dapat digunakan.', fetchedAt: new Date().toISOString() }], buildSourceContext: () => '<SOURCE id="source-1">CONTENT</SOURCE>' };
  const content = { generateContent: async options => ({ topic: 'Ringkasan', hook: 'Ringkasan sumber', body: 'Satu fakta', caption: 'Satu fakta', hashtags: [], cta: 'Baca sumber', verificationStatus: 'needs_review', unsupportedClaims: [] }) };
  const { app } = setup({ content, sourceFetcher });
  const response = await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Sumber terbatas', useSources: true, sourceUrls: ['https://example.com'] }).expect(200);
  assert.equal(response.body.render_source.verificationStatus, 'needs_review');
});

test('fetch sumber gagal menghentikan pembuatan konten', async () => {
  let called = false;
  const sourceFetcher = { fetchSources: async () => { throw Object.assign(new Error('Gagal mengambil sumber https://example.com: Timeout'), { status: 400 }); }, buildSourceContext: () => '' };
  const content = { generateContent: async () => { called = true; } };
  const { app } = setup({ content, sourceFetcher });
  await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Tema gagal', useSources: true, sourceUrls: ['https://example.com'] }).expect(400);
  assert.equal(called, false);
});


test('konten gagal grounding tidak disimpan', async () => {
  const content = { generateContent: async () => { throw Object.assign(new Error('Konten tidak dapat dibuat karena sebagian klaim tidak didukung sumber.'), { status: 422 }); } };
  const sourceFetcher = { validateSourceUrls: urls => urls, fetchSources: async urls => [{ url: urls[0], finalUrl: urls[0], title: 'Sumber', text: 'Isi sumber cukup panjang.', fetchedAt: new Date().toISOString() }], buildSourceContext: () => '<SOURCE id="source-1">CONTENT</SOURCE>' };
  const { app, db } = setup({ content, sourceFetcher });
  await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Tema grounding', useSources: true, sourceUrls: ['https://example.com'] }).expect(422);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM contents').get().count, 0);
});

test('topik trending memakai topik relevan dari service', async () => { let options; const content = { generateContent: async (topics, value) => { options = value; return { topic: value.requestedTopic, hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } }; const { app } = setup({ content, trending: { getLatest: async () => ['Tren Canva AI'] } }); const r = await request(app).post('/generate').send({ topicSource: 'trending' }).expect(200); assert.equal(options.requestedTopic, 'Tren Canva AI'); assert.equal(options.trendingFallback, false); assert.equal(r.body.topic_source, 'trending'); });
test('topik trending fallback ke AI berdasarkan tanggal saat service gagal', async () => { let options; const content = { generateContent: async (topics, value) => { options = value; return { topic: 'Tren AI Hari Ini', hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } }; const { app } = setup({ content, trending: { getLatest: async () => { throw new Error('offline'); } } }); await request(app).post('/generate').send({ topicSource: 'trending' }).expect(200); assert.equal(options.trendingFallback, true); assert.match(options.date, /^\d{4}-\d{2}-\d{2}$/); });
test('duplikat AI dibandingkan tanpa kapital dan spasi lalu generate ulang', async () => { let calls = 0; const content = { generateContent: async () => ({ topic: ++calls === 1 ? '  STORYBOARD   ai ' : 'Topik Unik', hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }) }; const { app, db } = setup({ content }); db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Storyboard AI','H','B','C','[]','CTA')").run(); const r = await request(app).post('/generate').send({ topicSource: 'ai' }).expect(200); assert.equal(calls, 2); assert.equal(r.body.topic, 'Topik Unik'); });
test('history mengembalikan konten terbaru', async () => { const { app } = setup(); await request(app).post('/generate'); const r = await request(app).get('/history').expect(200); assert.equal(r.body.length, 1); });
test('hapus satu konten menolak ID invalid dan hanya menghapus item yang dipilih', async () => {
  const { app, db } = setup();
  await request(app).post('/generate');
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Tetap ada','H','B','C','[]','CTA')").run();
  await request(app).delete('/history/abc').expect(400);
  const response = await request(app).delete('/history/1').expect(200);
  assert.equal(response.body.deleted, 1);
  assert.deepEqual(db.prepare('SELECT topic FROM contents ORDER BY id').all(), [{ topic: 'Tetap ada' }]);
});
test('hapus seluruh riwayat mengosongkan database', async () => {
  const { app, db } = setup();
  await request(app).post('/generate');
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Konten dua','H','B','C','[]','CTA')").run();
  const response = await request(app).delete('/history').expect(200);
  assert.equal(response.body.deleted, 2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM contents').get().count, 0);
});
test('upload ditolak bila OAuth belum terhubung', async () => { const { app } = setup(); const c = await request(app).post('/generate'); const r = await request(app).post('/upload-tiktok').send({ id: c.body.id }).expect(401); assert.match(r.body.error, /Hubungkan/); });
test('upload memvalidasi slide dan menampilkan pesan Indonesia sebelum mengirim ke TikTok', async () => {
  const images = {
    createSlides: async () => ['/generated/slide-lama.png'],
    validateSlides: async () => { throw Object.assign(new Error('File slide bukan JPEG asli. Buat ulang konten sebelum mengunggah.'), { status: 400 }); }
  };
  const { app, db } = setup({ images });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  const c = await request(app).post('/generate');
  const r = await request(app).post('/upload-tiktok').send({ id: c.body.id }).expect(400);
  assert.match(r.body.error, /bukan JPEG asli/);
});
test('upload memeriksa URL publik sebelum mengirim draft ke TikTok', async () => {
  const calls = [];
  const tiktok = { randomState: () => 'state', authorizationUrl: () => '', validateImageUrls: async (urls, prefix) => calls.push({ urls, prefix }), publishPhotos: async () => ({ data: { publish_id: 'draft-1' } }) };
  const { app, db } = setup({ tiktok });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  const content = await request(app).post('/generate');
  const response = await request(app).post('/upload-tiktok').send({ id: content.body.id }).expect(200);
  assert.equal(response.body.publishId, 'draft-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prefix, 'http://localhost:3000/generated/');
  assert.ok(calls[0].urls.every(url => url.startsWith(calls[0].prefix)));
});
test('status draft menyimpan status, fail_reason, dan downloaded_bytes', async () => {
  const tiktok = { randomState: () => 'state', authorizationUrl: () => '', status: async () => ({ data: { status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 } }) };
  const { app, db } = setup({ tiktok });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta,publish_id) VALUES('T','H','B','C','[]','CTA','pub-1')").run();
  const response = await request(app).get('/status/pub-1').expect(200);
  assert.deepEqual(response.body, { status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 });
  const saved = db.prepare("SELECT publish_status,fail_reason,downloaded_bytes FROM contents WHERE publish_id='pub-1'").get();
  assert.deepEqual(saved, { publish_status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 });
});
test('OAuth dimulai dengan state server-side dan redirect URI konfigurasi yang sama', async () => {
  let authorizeArgs;
  const tiktok = { randomState: () => 'secure-state', authorizationUrl: (...args) => { authorizeArgs = args; return 'https://example.com/oauth'; } };
  const { app, db } = setup({ tiktok });
  await request(app).get('/auth/tiktok').set('Host', 'fresh-tunnel.ngrok.app').set('X-Forwarded-Proto', 'https').expect(302).expect('Location', 'https://example.com/oauth');
  const saved = db.prepare("SELECT * FROM oauth_states WHERE state='secure-state'").get();
  assert.equal(saved.redirect_uri, 'https://fresh-tunnel.ngrok.app/auth/tiktok/callback');
  assert.deepEqual(authorizeArgs, ['secure-state', saved.redirect_uri]);
  assert.ok(saved.expires_at > Date.now());
});
test('callback menerima state yang cocok dan menyimpan token hanya setelah validasi akun', async () => {
  let exchanges = 0;
  const tiktok = { randomState: () => 'matching-state', authorizationUrl: () => 'https://example.com/oauth', exchangeCode: async () => { exchanges++; return { access_token: 'new-token', refresh_token: 'refresh', expires_in: 3600, refresh_expires_in: 86400, scope: 'video.upload' }; }, validateAccessToken: async () => ({ openId: 'user-1', displayName: 'Creator' }) };
  const { app, db } = setup({ tiktok });
  await request(app).get('/auth/tiktok').expect(302);
  await request(app).get('/auth/tiktok/callback?state=matching-state&code=valid-code').expect(302).expect('Location', '/?oauth=success');
  assert.equal(exchanges, 1);
  assert.deepEqual(db.prepare("SELECT access_token,open_id,display_name FROM oauth_tokens WHERE provider='tiktok'").get(), { access_token: 'new-token', open_id: 'user-1', display_name: 'Creator' });
});
test('callback menolak state berbeda', async () => {
  let exchanges = 0;
  const { app } = setup({ tiktok: { randomState: () => 'expected-state', authorizationUrl: () => 'https://example.com/oauth', exchangeCode: async () => { exchanges++; } } });
  await request(app).get('/auth/tiktok').expect(302);
  const response = await request(app).get('/auth/tiktok/callback?state=different-state&code=unused').expect(302);
  assert.match(response.headers.location, /^\/?\?oauth=error&reason=/);
  assert.equal(exchanges, 0);
});
test('callback menolak pemakaian state kedua kali', async () => {
  let exchanges = 0;
  const tiktok = { randomState: () => 'one-time-state', authorizationUrl: () => 'https://example.com/oauth', exchangeCode: async () => { exchanges++; return { access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }; }, validateAccessToken: async () => ({ openId: 'user', displayName: 'User' }) };
  const { app } = setup({ tiktok });
  await request(app).get('/auth/tiktok').expect(302);
  await request(app).get('/auth/tiktok/callback?state=one-time-state&code=first').expect(302).expect('Location', '/?oauth=success');
  const second = await request(app).get('/auth/tiktok/callback?state=one-time-state&code=second').expect(302);
  assert.match(second.headers.location, /oauth=error/);
  assert.equal(exchanges, 1);
});
test('status tanpa token mengembalikan kontrak missing_token', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/tiktok/status').expect(200);
  assert.deepEqual(response.body, { connected: false, account: null, reason: 'missing_token' });
  assert.match(response.headers['cache-control'], /no-store/);
});
test('status token expired tanpa refresh valid mengembalikan expired_token', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','expired',?)").run(Date.now() - 1);
  await request(app).get('/api/tiktok/status').expect(200, { connected: false, account: null, reason: 'expired_token' });
});
test('status connected hanya setelah API TikTok memvalidasi akun', async () => {
  const { app, db } = setup({ tiktok: { validateAccessToken: async () => ({ openId: 'open-1', displayName: 'Creator' }) } });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at) VALUES('tiktok','valid','refresh',?)").run(Date.now() + 3600000);
  await request(app).get('/api/tiktok/status').expect(200, { connected: true, account: { displayName: 'Creator', openId: 'open-1' } });
});
test('disconnect menghapus token, state, dan status tetap false setelah request baru', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at) VALUES('tiktok','token','refresh',?)").run(Date.now() + 3600000);
  db.prepare("INSERT INTO oauth_states(state,provider,expires_at) VALUES('old','tiktok',?)").run(Date.now() + 1000);
  await request(app).delete('/api/tiktok/connection').expect(200, { disconnected: true });
  assert.equal(db.prepare("SELECT 1 FROM oauth_tokens WHERE provider='tiktok'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM oauth_states WHERE provider='tiktok'").get(), undefined);
  await request(app).get('/api/tiktok/status').expect(200, { connected: false, account: null, reason: 'missing_token' });
});
test('reconnect membuat state baru tanpa fake Connected dan kegagalan tidak merusak token lama', async () => {
  const tiktok = { randomState: () => 'reconnect-state', authorizationUrl: () => 'https://example.com/oauth', exchangeCode: async () => { throw new Error('exchange failed'); }, validateAccessToken: async () => ({ openId: 'old-user', displayName: 'Old User' }) };
  const { app, db } = setup({ tiktok });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at,open_id,display_name) VALUES('tiktok','existing','refresh',?,'old-user','Old User')").run(Date.now() + 3600000);
  await request(app).get('/auth/tiktok').expect(302);
  assert.equal(db.prepare("SELECT access_token FROM oauth_tokens WHERE provider='tiktok'").get().access_token, 'existing');
  const failed = await request(app).get('/auth/tiktok/callback?state=reconnect-state&code=bad').expect(302);
  assert.match(failed.headers.location, /oauth=error/);
  assert.equal(db.prepare("SELECT access_token FROM oauth_tokens WHERE provider='tiktok'").get().access_token, 'existing');
});
test('mobile dan desktop menggunakan satu TikTokConnection tanpa status browser-storage atau pesan inline', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.equal((html.match(/class="tiktok-connection"/g) || []).length, 1);
  assert.equal((script.match(/class TikTokConnection/g) || []).length, 1);
  assert.match(html, />Hubungkan TikTok</);
  assert.doesNotMatch(html, /connection-message|drawer-tiktok|mobile-tiktok-connect/);
  assert.doesNotMatch(script, /localStorage.*tiktok|sessionStorage.*tiktok/i);
});
test('halaman legal publik dapat diakses', async () => { const { app } = setup(); const terms = await request(app).get('/terms').expect(200).expect('Content-Type', /html/); assert.match(terms.text, /Terms of Service/); const privacy = await request(app).get('/privacy').expect(200).expect('Content-Type', /html/); assert.match(privacy.text, /Privacy Policy/); });
test('halaman utama menampilkan tautan legal di footer', async () => { const { app } = setup(); const r = await request(app).get('/').expect(200); assert.match(r.text, /<footer>/); assert.match(r.text, /href="\/terms"/); assert.match(r.text, /href="\/privacy"/); });
test('desktop dan mobile memakai satu komponen kontrol TikTok yang lengkap', () => { const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'); assert.equal((html.match(/class="tiktok-connection"/g) || []).length, 1); assert.match(html, />Hubungkan TikTok</); assert.match(html, />Reconnect</); assert.match(html, />Disconnect</); assert.match(html, /TikTok Disconnected|Memuat TikTok/); assert.doesNotMatch(html, /drawer-tiktok|mobile-tiktok-connect/); });
test('browser melakukan polling draft tiap 10 detik selama maksimal 5 menit dengan pesan yang tepat', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(script, /setTimeout\(resolve, 10 \* 1000\)/);
  assert.match(script, /Date\.now\(\) - startedAt < 5 \* 60 \* 1000/);
  assert.match(script, /data\.status === 'SEND_TO_USER_INBOX'/);
  assert.match(script, /Draft berhasil dikirim\. Buka Inbox TikTok untuk melanjutkan\./);
  assert.match(script, /TikTok belum berhasil mengunduh gambar\. Periksa URL gambar dan coba lagi\./);
  assert.doesNotMatch(script, /data\.status === 'PUBLISH_COMPLETE'/);
});
test('generate menyimpan kategori dan format serta meneruskannya ke AI', async () => {
  let options;
  const content = { generateContent: async (topics, value) => { options = value; return { topic: 'Teknik Pomodoro', hook: 'Fokus', body: '- Mulai singkat\n- Istirahat', caption: 'Praktikkan', hashtags: ['#Produktivitas'], cta: 'Simpan' }; } };
  const { app } = setup({ content });
  const r = await request(app).post('/generate').send({ topicSource: 'ai', contentCategory: 'Produktivitas', contentFormat: 'Tips cepat' }).expect(200);
  assert.equal(r.body.content_category, 'Produktivitas');
  assert.equal(r.body.content_format, 'Tips cepat');
  assert.equal(options.contentCategory, 'Produktivitas');
  assert.equal(options.contentFormat, 'Tips cepat');
});
test('kategori custom wajib diisi dan nilai custom disimpan', async () => {
  const { app } = setup();
  await request(app).post('/generate').send({ contentCategory: 'Custom', contentFormat: 'Listicle' }).expect(400);
  const r = await request(app).post('/generate').send({ contentCategory: 'Custom', customCategory: '  kesehatan mental ', contentFormat: 'Listicle' }).expect(200);
  assert.equal(r.body.content_category, 'kesehatan mental');
});
test('kategori dan format yang tidak dikenal ditolak', async () => {
  const { app } = setup();
  await request(app).post('/generate').send({ contentCategory: 'Tidak valid', contentFormat: 'Listicle' }).expect(400);
  await request(app).post('/generate').send({ contentCategory: 'Motivasi', contentFormat: 'Tidak valid' }).expect(400);
});

test('konfigurasi background carousel diterapkan ke export dan disimpan bersama draft', async () => {
  let rendered;
  const images = { createSlides: async (id, content) => { rendered = content.background; return [1, 2, 3].map(index => `/generated/${id}-${index}.jpg`); }, validateSlides: async () => {} };
  const { app } = setup({ images });
  const background = { type: 'color', color: '#E9E1D3', assetId: null, previewUrl: null, applyToAllSlides: false, slideBackgrounds: { 1: { type: 'color', color: '#FFFFFF', assetId: null, previewUrl: null } } };
  const response = await request(app).post('/generate').send({ background }).expect(200);
  assert.equal(rendered.color, '#E9E1D3');
  assert.equal(rendered.applyToAllSlides, false);
  assert.equal(rendered.slideBackgrounds[1].color, '#FFFFFF');
  assert.equal(response.body.background.color, '#E9E1D3');
  assert.equal(response.body.background.slideBackgrounds[1].color, '#FFFFFF');
  assert.equal(response.body.slides.length, 3);
});

test('background tidak valid dinormalisasi ke Hitam agar draft dan export aman', async () => {
  let rendered;
  const images = { createSlides: async (id, content) => { rendered = content.background; return [`/generated/${id}-1.jpg`]; }, validateSlides: async () => {} };
  const { app } = setup({ images });
  const response = await request(app).post('/generate').send({ background: { type: 'color', color: 'url(javascript:bad)' } }).expect(200);
  assert.equal(rendered.color, '#0B0B0D');
  assert.equal(response.body.background.color, '#0B0B0D');
});

test('generation menerima background warna global dan gambar upload per slide tanpa mengubah watermark', async () => {
  let rendered;
  const images = { createSlides: async (id, content) => { rendered = content; return [`/generated/${id}-1.jpg`, `/generated/${id}-2.jpg`]; }, validateSlides: async () => {} };
  const { app } = setup({ images });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzZ9QAAAABJRU5ErkJggg==';
  const asset = await request(app).post('/api/assets/upload').send({ name: 'background.png', mimeType: 'image/png', data: png, tags: ['Background'] }).expect(201);
  const uploadedBackground = { assetId: asset.body.id, previewUrl: asset.body.preview_url, textColor: '#FFFFFF' };
  const background = { type: 'color', color: '#FFFFFF', assetId: null, previewUrl: null, textColor: '#000000', uploadedBackground, applyToAllSlides: false, slideBackgrounds: { 1: { type: 'image', color: '#FFFFFF', ...uploadedBackground } } };
  const response = await request(app).post('/generate').send({ watermarkEnabled: true, background }).expect(200);
  assert.equal(rendered.watermark.enabled, true);
  assert.equal(rendered.background.color, '#FFFFFF');
  assert.equal(rendered.background.type, 'color');
  assert.equal(rendered.background.slideBackgrounds[1].assetId, asset.body.id);
  assert.match(rendered.background.slideBackgrounds[1].imageData, /^data:image\/png;base64,/);
  assert.equal(response.body.background.uploadedBackground.assetId, asset.body.id);
  assert.equal(response.body.background.slideBackgrounds[1].assetId, asset.body.id);
  assert.equal(response.body.background.slideBackgrounds[1].imageData, undefined);
});

test('live preview rerender menyimpan background global dan per-slide yang sama dengan export', async () => {
  const renders = [];
  const images = { createSlides: async (id, content) => { renders.push(content); return [`/generated/${id}-1.jpg`, `/generated/${id}-2.jpg`, `/generated/${id}-3.jpg`]; }, validateSlides: async () => {} };
  const { app } = setup({ images });
  const generated = await request(app).post('/generate').send({ background: { type: 'color', color: '#0B0B0D', applyToAllSlides: true } }).expect(200);
  const background = { type: 'color', color: '#FFFFFF', textColor: '#000000', applyToAllSlides: false, slideBackgrounds: { 1: { type: 'color', color: '#E9E1D3', textColor: '#000000' } } };
  const updated = await request(app).patch(`/contents/${generated.body.id}/background`).send({ background }).expect(200);
  assert.equal(renders.length, 2);
  assert.equal(renders[1].background.color, '#FFFFFF');
  assert.equal(renders[1].background.slideBackgrounds[1].color, '#E9E1D3');
  assert.equal(updated.body.background.color, '#FFFFFF');
  assert.equal(updated.body.background.slideBackgrounds[1].color, '#E9E1D3');
  assert.notDeepEqual(updated.body.slides, generated.body.slides);
});

test('generation mempromosikan file pending ke path stabil content ID dan history menghapusnya', async (t) => {
  const db = createDatabase(':memory:');
  const content = { generateContent: async () => ({ topic: `Stable ${Date.now()}`, hook: 'Hook', body: '1. Langkah', caption: 'Caption', hashtags: ['#test'], cta: 'CTA' }) };
  const app = createApp({ db, content, trending: { getLatest: async () => [] } });
  const generated = await request(app).post('/generate').send({ topicSource: 'ai' }).expect(200);
  assert.deepEqual(generated.body.slides, [1, 2, 3].map(index => `/generated/${generated.body.id}-${index}.jpg`));
  const dir = path.join(process.cwd(), 'public/generated');
  const names = fs.readdirSync(dir);
  assert.equal(names.some(name => name.startsWith('pending-') && name.endsWith('.jpg')), false);
  for (const slide of generated.body.slides) assert.equal(fs.existsSync(path.join(process.cwd(), 'public', slide)), true);
  await request(app).delete(`/history/${generated.body.id}`).expect(200);
  for (const slide of generated.body.slides) assert.equal(fs.existsSync(path.join(process.cwd(), 'public', slide)), false);
  t.after(() => db.close());
});

test('rerender gagal mempertahankan slide dan background database sebelumnya tanpa temporary file', async () => {
  let calls = 0;
  const images = { createSlides: async id => { if (++calls > 1) throw new Error('render gagal'); return [`/generated/${id}-1.jpg`]; }, validateSlides: async () => {}, cleanupSlides: async () => {} };
  const { app, db } = setup({ images });
  const generated = await request(app).post('/generate').send({ background: { type: 'color', color: '#0B0B0D' } }).expect(200);
  await request(app).patch(`/contents/${generated.body.id}/background`).send({ revision: 1, background: { type: 'color', color: '#FFFFFF' } }).expect(500);
  const saved = db.prepare('SELECT slides,background FROM contents WHERE id=?').get(generated.body.id);
  assert.deepEqual(JSON.parse(saved.slides), generated.body.slides);
  assert.equal(JSON.parse(saved.background).color, '#0B0B0D');
});

test('request background cepat hanya menyimpan revisi terbaru', async () => {
  let calls = 0; const cleaned = [];
  const images = { createSlides: async id => { calls++; if (calls === 2) await new Promise(resolve => setTimeout(resolve, 30)); return [`/generated/${id}-1.jpg`]; }, validateSlides: async () => {}, cleanupSlides: async files => cleaned.push(...files) };
  const { app, db } = setup({ images });
  const generated = await request(app).post('/generate').expect(200);
  const first = request(app).patch(`/contents/${generated.body.id}/background`).send({ revision: 10, background: { type: 'color', color: '#FFFFFF' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  const latest = request(app).patch(`/contents/${generated.body.id}/background`).send({ revision: 11, background: { type: 'color', color: '#E9E1D3' } });
  const [oldResponse, latestResponse] = await Promise.all([first, latest]);
  assert.equal(oldResponse.status, 409); assert.equal(latestResponse.status, 200);
  const saved = db.prepare('SELECT background,background_revision FROM contents WHERE id=?').get(generated.body.id);
  assert.equal(JSON.parse(saved.background).color, '#E9E1D3'); assert.equal(saved.background_revision, 11);
  assert.ok(cleaned.some(file => file.includes('-10-')));
});

test('legacy content menyimpan pilihan tetapi tidak merusak slide lama', async () => {
  const { app, db } = setup();
  const result = db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta,slides) VALUES('Legacy','H','B','C','[]','CTA','[\"/generated/legacy.jpg\"]')").run();
  const response = await request(app).patch(`/contents/${result.lastInsertRowid}/background`).send({ revision: 2, background: { type: 'color', color: '#FFFFFF' } }).expect(409);
  assert.equal(response.body.legacy, true);
  const saved = db.prepare('SELECT slides,background FROM contents WHERE id=?').get(result.lastInsertRowid);
  assert.equal(saved.slides, '["/generated/legacy.jpg"]'); assert.equal(JSON.parse(saved.background).color, '#FFFFFF');
});
