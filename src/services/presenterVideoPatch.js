const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const config = require('../config');
const { StorageService } = require('../storage/service');

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const SLIDE_HEIGHT_WITH_PRESENTER = 1380;
const PRESENTER_HEIGHT = VIDEO_HEIGHT - SLIDE_HEIGHT_WITH_PRESENTER;

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', error => reject(Object.assign(error, { command })));
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`${command} gagal (${code}): ${stderr.trim().slice(-4000) || 'tanpa detail error'}`);
      error.code = 'MEDIA_COMPOSE_FAILED';
      error.status = 500;
      reject(error);
    });
  });
}

function encoderCandidatesFromList(value = '') {
  const encoders = String(value || '');
  const candidates = [];
  if (/\blibx264\b/i.test(encoders)) candidates.push({ name: 'libx264', options: ['-preset', 'veryfast', '-crf', '21'] });
  if (/\blibopenh264\b/i.test(encoders)) candidates.push({ name: 'libopenh264', options: ['-b:v', '5M', '-maxrate', '6M', '-bufsize', '10M'] });
  if (/\bmpeg4\b/i.test(encoders)) candidates.push({ name: 'mpeg4', options: ['-q:v', '3'] });
  return candidates;
}

function encoderFromList(value = '') {
  return encoderCandidatesFromList(value)[0] || null;
}

function videoCodecArgs(encoder) {
  return ['-c:v', encoder.name, ...encoder.options, '-pix_fmt', 'yuv420p'];
}

async function encoderActuallyWorks(encoder) {
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=1:d=0.1',
      '-frames:v', '1', '-an', ...videoCodecArgs(encoder), '-f', 'null', '-'
    ]);
    return true;
  } catch {
    return false;
  }
}

async function ensureFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    const listed = await run('ffmpeg', ['-hide_banner', '-encoders']);
    const candidates = encoderCandidatesFromList(`${listed.stdout}\n${listed.stderr}`);
    if (!candidates.length) {
      throw Object.assign(new Error('FFmpeg tersedia tetapi tidak memiliki encoder video yang didukung (libx264, libopenh264, atau mpeg4).'), { code: 'FFMPEG_ENCODER_MISSING' });
    }
    for (const encoder of candidates) {
      if (await encoderActuallyWorks(encoder)) return encoder;
    }
    throw Object.assign(new Error('FFmpeg mendeteksi encoder video, tetapi tidak ada yang benar-benar dapat dijalankan. Renderer lokal dihentikan sebelum provider video dipanggil agar kredit tidak terbuang.'), { code: 'FFMPEG_ENCODER_RUNTIME_BROKEN' });
  } catch (error) {
    if (['FFMPEG_ENCODER_MISSING', 'FFMPEG_ENCODER_RUNTIME_BROKEN'].includes(error.code)) {
      throw Object.assign(error, { status: 503 });
    }
    throw Object.assign(new Error('FFmpeg/ffprobe belum siap di VPS. Pastikan paket FFmpeg terpasang dan memiliki encoder video yang berfungsi.'), { status: 503, code: 'FFMPEG_MISSING', cause: error });
  }
}

function slideFile(slideUrl) {
  const value = String(slideUrl || '');
  if (!/^\/generated\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(value)) {
    throw Object.assign(new Error('Path slide tidak valid untuk komposisi video.'), { status: 422, code: 'INVALID_SLIDE_PATH' });
  }
  const root = path.resolve(config.root, 'public/generated');
  const candidate = path.resolve(root, path.basename(value));
  if (path.dirname(candidate) !== root) throw Object.assign(new Error('Path slide berada di luar folder generated.'), { status: 422, code: 'INVALID_SLIDE_PATH' });
  return candidate;
}

async function prepareLocalRender({ db, contentId }) {
  const content = db.prepare('SELECT id,topic,slides,render_source FROM contents WHERE id=?').get(Number(contentId));
  if (!content) throw Object.assign(new Error('Text Content tidak ditemukan.'), { status: 404, code: 'CONTENT_NOT_FOUND' });
  const slides = parseJson(content.slides, []);
  if (!Array.isArray(slides) || slides.length < 1) throw Object.assign(new Error('Text Content belum memiliki slide hasil render.'), { status: 422, code: 'SLIDES_MISSING' });
  const slideFiles = slides.map(slideFile);
  await Promise.all(slideFiles.map(file => fs.access(file)));
  const encoder = await ensureFfmpeg();
  return { content, slides, slideFiles, encoder };
}

async function probeDuration(file) {
  const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const duration = Number(String(result.stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) throw Object.assign(new Error('Durasi video presenter tidak dapat dibaca.'), { status: 422, code: 'INVALID_PRESENTER_DURATION' });
  return Math.max(1, Math.min(60, duration));
}

async function assertAudio(file, slideNumber) {
  const result = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  if (!String(result.stdout || '').trim()) {
    throw Object.assign(new Error(`Video presenter untuk slide ${slideNumber} tidak memiliki suara. Model video yang dipakai harus menghasilkan audio/narasi agar video final dapat dibuat.`), { status: 422, code: 'PRESENTER_AUDIO_MISSING' });
  }
}

function generatedAssetId(row) {
  const metadata = parseJson(row?.metadata, {});
  const media = parseJson(row?.media, []);
  return metadata.generatedAssetId || media?.[0]?.assetId || null;
}

async function materializeJobVideo({ db, storage, jobId, dir, index }) {
  const row = db.prepare('SELECT id,status,media_type,metadata,media,error_message FROM ai_generations WHERE id=?').get(String(jobId));
  if (!row) throw Object.assign(new Error(`Job presenter slide ${index + 1} tidak ditemukan.`), { status: 404, code: 'PRESENTER_JOB_NOT_FOUND' });
  if (row.status !== 'Completed') throw Object.assign(new Error(`Job presenter slide ${index + 1} belum selesai (${row.status}).`), { status: 409, code: 'PRESENTER_JOB_NOT_COMPLETED' });
  if (row.media_type !== 'video') throw Object.assign(new Error(`Job presenter slide ${index + 1} bukan video.`), { status: 422, code: 'PRESENTER_JOB_NOT_VIDEO' });
  const assetId = generatedAssetId(row);
  if (!assetId) throw Object.assign(new Error(`File presenter slide ${index + 1} tidak ditemukan.`), { status: 404, code: 'PRESENTER_ASSET_MISSING' });
  const asset = storage.repository.get(String(assetId));
  if (!asset || asset.deleted_at) throw Object.assign(new Error(`Asset presenter slide ${index + 1} tidak tersedia.`), { status: 404, code: 'PRESENTER_ASSET_MISSING' });
  const preview = await storage.preview(asset);
  if (!preview?.data?.length) throw Object.assign(new Error(`File presenter slide ${index + 1} kosong.`), { status: 422, code: 'PRESENTER_ASSET_EMPTY' });
  const target = path.join(dir, `presenter-${index + 1}.mp4`);
  await fs.writeFile(target, preview.data);
  await assertAudio(target, index + 1);
  return target;
}

async function renderSegment({ slide, presenter, output, audioOnly, duration, encoder }) {
  const durationArg = duration.toFixed(3);
  if (audioOnly) {
    const filter = `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[outv]`;
    await run('ffmpeg', [
      '-y', '-loop', '1', '-framerate', '30', '-i', slide, '-i', presenter,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '1:a:0', '-t', durationArg, '-r', '30',
      ...videoCodecArgs(encoder),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output
    ]);
    return;
  }

  const filter = [
    `color=c=0x09090b:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:r=30:d=${durationArg}[base]`,
    `[0:v]scale=${VIDEO_WIDTH}:${SLIDE_HEIGHT_WITH_PRESENTER}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[slide]`,
    `[1:v]scale=${VIDEO_WIDTH}:${PRESENTER_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${VIDEO_WIDTH}:${PRESENTER_HEIGHT}:0:0,setsar=1[presenter]`,
    `[base][slide]overlay=(W-w)/2:0:shortest=1[top]`,
    `[top][presenter]overlay=0:${SLIDE_HEIGHT_WITH_PRESENTER}:shortest=1,format=yuv420p[outv]`
  ].join(';');

  await run('ffmpeg', [
    '-y', '-loop', '1', '-framerate', '30', '-i', slide, '-i', presenter,
    '-filter_complex', filter,
    '-map', '[outv]', '-map', '1:a:0', '-t', durationArg, '-r', '30',
    ...videoCodecArgs(encoder),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output
  ]);
}

function concatLine(file) {
  return `file '${String(file).replace(/'/g, "'\\''")}'`;
}

async function concatSegments(files, output, dir, encoder) {
  const list = path.join(dir, 'segments.txt');
  await fs.writeFile(list, `${files.map(concatLine).join('\n')}\n`);
  try {
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output]);
  } catch (_) {
    await run('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      ...videoCodecArgs(encoder),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output
    ]);
  }
}

async function compose({ db, contentId, jobIds, audioOnlySlides = [3] }) {
  const prepared = await prepareLocalRender({ db, contentId });
  const { content, slides, slideFiles, encoder } = prepared;
  if (!Array.isArray(jobIds) || jobIds.length !== slides.length) throw Object.assign(new Error(`Dibutuhkan tepat ${slides.length} job presenter, satu untuk setiap slide.`), { status: 422, code: 'PRESENTER_JOB_COUNT_MISMATCH' });
  const audioOnly = new Set((Array.isArray(audioOnlySlides) ? audioOnlySlides : [3]).map(Number).filter(Number.isInteger));
  const storage = new StorageService({ db });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiads-presenter-'));

  try {
    const presenterFiles = [];
    for (let index = 0; index < jobIds.length; index += 1) presenterFiles.push(await materializeJobVideo({ db, storage, jobId: jobIds[index], dir, index }));

    const segments = [];
    for (let index = 0; index < slides.length; index += 1) {
      const duration = await probeDuration(presenterFiles[index]);
      const segment = path.join(dir, `segment-${index + 1}.mp4`);
      await renderSegment({
        slide: slideFiles[index],
        presenter: presenterFiles[index],
        output: segment,
        audioOnly: audioOnly.has(index + 1),
        duration,
        encoder
      });
      segments.push(segment);
    }

    const finalPath = path.join(dir, `content-${content.id}-presenter.mp4`);
    await concatSegments(segments, finalPath, dir, encoder);
    const finalData = await fs.readFile(finalPath);
    const asset = await storage.upload({
      name: `content-${content.id}-presenter.mp4`,
      mimeType: 'video/mp4',
      type: 'video',
      data: finalData,
      generated: true,
      tags: ['presenter-video', 'text-content-video'],
      metadata: {
        feature: 'slide-presenter-video',
        contentId: content.id,
        sourceSlides: slides,
        presenterJobIds: jobIds.map(String),
        audioOnlySlides: [...audioOnly].sort((a, b) => a - b),
        encoder: encoder.name,
        layout: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, slideHeight: SLIDE_HEIGHT_WITH_PRESENTER, presenterHeight: PRESENTER_HEIGHT }
      }
    });
    return {
      assetId: asset.id,
      resultUrl: `/api/assets/${encodeURIComponent(asset.id)}/preview`,
      downloadUrl: `/api/assets/${encodeURIComponent(asset.id)}/preview`,
      slideCount: slides.length,
      audioOnlySlides: [...audioOnly].sort((a, b) => a - b),
      encoder: encoder.name
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function install({ app, db }) {
  if (!app || !db || app.__aiadsPresenterVideoPatch) return;
  app.__aiadsPresenterVideoPatch = true;

  app.post('/api/presenter-video/preflight', async (req, res) => {
    try {
      const prepared = await prepareLocalRender({ db, contentId: req.body?.contentId });
      res.json({ ok: true, encoder: prepared.encoder.name, slideCount: prepared.slides.length });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Renderer lokal belum siap', code: error.code || null });
    }
  });

  app.post('/api/presenter-video/compose', async (req, res) => {
    try {
      const result = await compose({
        db,
        contentId: req.body?.contentId,
        jobIds: req.body?.jobIds,
        audioOnlySlides: req.body?.audioOnlySlides
      });
      res.status(201).json(result);
    } catch (error) {
      if (!error.status || error.status >= 500) console.error('[Presenter Video]', error);
      res.status(error.status || 500).json({ error: error.message || 'Gagal menyusun video presenter', code: error.code || null });
    }
  });
}

module.exports = { install, compose, slideFile, generatedAssetId, encoderFromList, encoderCandidatesFromList, encoderActuallyWorks, ensureFfmpeg, prepareLocalRender };
