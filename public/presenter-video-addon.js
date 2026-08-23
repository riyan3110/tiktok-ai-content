(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__AIADS_PRESENTER_VIDEO_ADDON__) return;
  window.__AIADS_PRESENTER_VIDEO_ADDON__ = true;

  const $ = selector => document.querySelector(selector);
  const terminal = new Set(['Completed', 'Failed', 'Cancelled']);
  const referenceProviders = new Set(['vidu', '9router', 'orcarouter', 'omni']);
  const providerPriority = ['vidu', '9router', 'orcarouter', 'omni'];
  const AUDIO_ONLY_SLIDE = 3;

  let activeContent = null;
  let presenterAsset = null;
  let installed = false;
  let running = false;

  const safe = value => {
    const node = document.createElement('span');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  };

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Permintaan gagal (${response.status})`);
    return data;
  };

  function normalizeSpokenText(value) {
    return String(value || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s*(?:SLIDE\s*\d+|HOOK|FAKTA UTAMA|DETAIL|PENUTUP|CAPTION|TAGAR)\s*:?[\s-]*/gim, '')
      .replace(/^\s*[•*-]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function structuredSlides(item) {
    const source = item?.render_source?.slides;
    return Array.isArray(source) ? source : [];
  }

  function narrationForSlide(slide) {
    const parts = [slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
      .map(normalizeSpokenText)
      .filter(Boolean);
    return parts.join('. ').replace(/\.{2,}/g, '.').trim();
  }

  function slideEntries() {
    const images = Array.isArray(activeContent?.slides) ? activeContent.slides : [];
    const source = structuredSlides(activeContent);
    if (!images.length) throw new Error('Text Content belum memiliki slide hasil render.');
    if (source.length !== images.length) {
      throw new Error('Struktur isi per slide tidak lengkap. Video presenter tidak dibuat supaya isi slide tidak salah atau berubah.');
    }
    return images.map((image, index) => {
      const narration = narrationForSlide(source[index]);
      if (!narration) throw new Error(`Isi Slide ${index + 1} kosong sehingga belum bisa dibuat narasi.`);
      return { index, image, source: source[index], narration, audioOnly: index + 1 === AUDIO_ONLY_SLIDE };
    });
  }

  function styleInstruction(template) {
    return ({
      clean: 'Clean contemporary presenter framing, soft natural light, simple neutral background, credible and realistic.',
      news: 'Professional short-form news presenter framing, clean neutral background, confident but restrained.',
      casual: 'Natural creator-style presenter framing, relaxed social-video delivery, subtle realistic movement.',
      cinematic: 'Polished cinematic presenter framing with natural dramatic light and controlled subtle motion.'
    })[template] || 'Clean contemporary presenter framing, credible and realistic.';
  }

  function voiceInstruction(voice) {
    return ({
      natural: 'Speak Indonesian naturally and conversationally with human pacing and small pauses.',
      calm: 'Speak Indonesian calmly and warmly with measured pacing and natural pauses.',
      news: 'Speak Indonesian clearly in a professional news-explainer tone without sounding theatrical.',
      energetic: 'Speak Indonesian with lively but controlled social-video energy and natural pronunciation.'
    })[voice] || 'Speak Indonesian naturally with human pacing and clear pronunciation.';
  }

  function buildPresenterPrompt(entry) {
    const template = $('#presenter-video-template')?.value || 'clean';
    const voice = $('#presenter-video-voice')?.value || 'natural';
    const exactSpeech = entry.narration.slice(0, 3600);
    return [
      'Create only a talking-presenter clip from the supplied single presenter reference image.',
      'The final slide artwork is composed later by AI Ads Lab, so do not recreate the slide, do not add B-roll, do not add captions, and do not add any on-screen text.',
      'Keep exactly one presenter. Preserve the same face, hair, clothing identity, skin tone, and overall appearance. Use subtle blinking, small head movement, restrained facial expression, realistic mouth movement, and no exaggerated gestures.',
      styleInstruction(template),
      voiceInstruction(voice),
      'The presenter must speak the Indonesian narration below. Do not paraphrase, summarize, translate, add facts, add numbers, or add conclusions. Finish the full narration before the clip ends.',
      `Exact narration for Slide ${entry.index + 1}:\n"${exactSpeech.replace(/"/g, '\\"')}"`
    ].join('\n\n');
  }

  async function resolveVideoModel(provider, assetCount) {
    const configured = provider?.models?.video || '';
    if (provider.id === 'vidu' && window.ContentStudioViduModels) {
      const state = window.ContentStudioViduModels.stateFor({ media: 'video', assetCount, configured });
      if (state.valid) return state.choice;
    }
    if (provider.id === '9router') {
      const catalog = await api('/api/ai/providers/9router/models');
      const group = catalog?.video || {};
      const models = [...(group.combos || []), ...(group.directModels || [])];
      return models.includes(configured) ? configured : models[0] || '';
    }
    if (provider.id === 'orcarouter') {
      const catalog = await api('/api/ai/providers/orcarouter/models');
      const models = catalog?.video || [];
      return models.includes(configured) ? configured : models[0] || '';
    }
    return configured;
  }

  async function chooseVideoProvider(assetCount) {
    const providers = (await api('/api/content-studio/providers'))
      .filter(provider => provider.types?.includes('video') && referenceProviders.has(provider.id));
    if (!providers.length) throw new Error('Belum ada provider video aktif yang dapat menerima foto presenter sebagai referensi.');

    providers.sort((a, b) => {
      const aDefault = a.defaultCapabilities?.includes('video') ? -100 : 0;
      const bDefault = b.defaultCapabilities?.includes('video') ? -100 : 0;
      const aRank = providerPriority.indexOf(a.id);
      const bRank = providerPriority.indexOf(b.id);
      return aDefault + (aRank < 0 ? 99 : aRank) - (bDefault + (bRank < 0 ? 99 : bRank));
    });

    for (const provider of providers) {
      try {
        const model = await resolveVideoModel(provider, assetCount);
        if (model) return { provider, model };
      } catch (error) {
        console.warn('[Presenter Video] provider dilewati', provider.id, error);
      }
    }
    throw new Error('Provider video aktif belum memiliki model image-to-video yang bisa dipakai.');
  }

  function setStatus(message, error = false) {
    const node = $('#presenter-video-status');
    if (!node) return;
    node.textContent = message || '';
    node.style.color = error ? '#fb7185' : '';
  }

  function setProgress(value, label) {
    const progress = $('#presenter-video-progress');
    const progressLabel = $('#presenter-video-progress-label');
    if (progress) progress.value = Math.max(0, Math.min(100, Number(value) || 0));
    if (progressLabel) progressLabel.textContent = label || '';
  }

  function resetResult() {
    const result = $('#presenter-video-result');
    if (result) result.classList.add('hidden');
    const video = $('#presenter-video-preview');
    if (video) {
      video.pause?.();
      video.removeAttribute('src');
      video.load?.();
    }
    const download = $('#presenter-video-download');
    if (download) download.removeAttribute('href');
    setProgress(0, 'Siap');
  }

  function renderPresenter() {
    const host = $('#presenter-video-presenter');
    if (!host) return;
    if (!presenterAsset) {
      host.innerHTML = '<span class="presenter-empty">Belum ada presenter dipilih.</span>';
      return;
    }
    host.innerHTML = `<img src="${safe(presenterAsset.previewUrl || presenterAsset.preview_url || `/api/assets/${encodeURIComponent(presenterAsset.id)}/preview`)}" alt="Presenter"><div><b>${safe(presenterAsset.name)}</b><small>Presenter terpilih</small></div>`;
  }

  function renderSlidePlan() {
    const host = $('#presenter-video-slides');
    if (!host) return;
    try {
      const entries = slideEntries();
      host.innerHTML = entries.map(entry => `
        <article class="presenter-slide-card">
          <img src="${safe(entry.image)}" alt="Slide ${entry.index + 1}">
          <div><b>Slide ${entry.index + 1}</b><small>${entry.audioOnly ? 'Slide penuh + suara' : 'Slide + presenter di bawah'}</small></div>
        </article>`).join('');
      $('#presenter-video-plan-note').textContent = entries.length >= AUDIO_ONLY_SLIDE
        ? `Slide asli tetap dipakai. Slide ${AUDIO_ONLY_SLIDE} tampil penuh dengan suara saja; slide lain memakai presenter di bagian bawah.`
        : 'Slide asli tetap dipakai dan presenter ditempatkan di bagian bawah.';
    } catch (error) {
      host.innerHTML = `<p class="presenter-plan-error">${safe(error.message)}</p>`;
      $('#presenter-video-plan-note').textContent = '';
    }
  }

  async function pickPresenter() {
    if (!window.AssetManager?.select) throw new Error('Asset Manager belum siap.');
    const selected = await window.AssetManager.select({ selectedIds: presenterAsset ? [presenterAsset.id] : [], multiple: false });
    if (!selected?.length) return;
    if (selected[0].type !== 'image') throw new Error('Presenter harus berupa gambar.');
    presenterAsset = selected[0];
    renderPresenter();
    resetResult();
  }

  const fileData = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  async function uploadPresenter(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('File presenter harus berupa gambar.');
    setStatus('Mengunggah presenter…');
    const uploaded = await api('/api/assets/upload', {
      method: 'POST',
      body: JSON.stringify({
        name: file.name || 'presenter.jpg',
        mimeType: file.type || 'image/jpeg',
        data: await fileData(file),
        tags: ['Character', 'Presenter'],
        metadata: { category: 'Character', purpose: 'presenter-video' }
      })
    });
    presenterAsset = {
      id: uploaded.id,
      name: uploaded.name,
      type: uploaded.type,
      previewUrl: uploaded.preview_url || `/api/assets/${encodeURIComponent(uploaded.id)}/preview`
    };
    renderPresenter();
    resetResult();
    setStatus('Presenter siap.');
  }

  function providerNotice(provider, model) {
    const node = $('#presenter-video-provider');
    if (!node) return;
    node.textContent = `Mesin presenter: ${provider.name || provider.id} · ${model}. Model harus menghasilkan audio agar video final bisa dirender.`;
  }

  async function waitForJob(id, entry, completedSlides, totalSlides) {
    while (true) {
      const job = await api(`/api/content-studio/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const fractional = Math.max(0, Math.min(100, Number(job.progress) || 0)) / 100;
      const generationProgress = 8 + ((completedSlides + fractional) / totalSlides) * 72;
      setProgress(generationProgress, `Slide ${entry.index + 1}/${totalSlides}: ${job.status || 'Memproses'}`);
      if (job.status === 'Completed') {
        if (job.result_missing || !job.result_url) throw new Error(`Provider selesai untuk Slide ${entry.index + 1}, tetapi file video presenter tidak tersedia.`);
        return job;
      }
      if (terminal.has(job.status)) throw new Error(job.error_message || `Generate presenter Slide ${entry.index + 1} ${String(job.status || '').toLowerCase()}.`);
      await sleep(1800);
    }
  }

  async function createPresenterJob(entry, selected) {
    const response = await api('/api/content-studio/generate', {
      method: 'POST',
      body: JSON.stringify({
        provider: selected.provider.id,
        model: selected.model,
        prompt: buildPresenterPrompt(entry),
        mediaType: 'video',
        promptSource: 'manual',
        assetIds: [presenterAsset.id],
        resolution: '1080p',
        aspectRatio: '9:16',
        count: 1,
        metadata: {
          feature: 'slide-presenter-clip',
          contentId: activeContent.id,
          slideIndex: entry.index,
          narration: entry.narration,
          audioOnlyInFinal: entry.audioOnly,
          template: $('#presenter-video-template')?.value || 'clean',
          voiceStyle: $('#presenter-video-voice')?.value || 'natural'
        }
      })
    });
    const id = response.ids?.[0] || response.id || '';
    if (!id) throw new Error(`Job presenter Slide ${entry.index + 1} tidak berhasil dibuat.`);
    return id;
  }

  async function generateVideo() {
    const button = $('#presenter-video-generate');
    if (running) return;
    try {
      if (!activeContent?.id) throw new Error('Pilih hasil Text Content terlebih dahulu.');
      if (!presenterAsset) throw new Error('Pilih satu foto presenter terlebih dahulu.');
      if (!$('#presenter-video-rights')?.checked) throw new Error('Konfirmasi hak penggunaan foto presenter terlebih dahulu.');
      const entries = slideEntries();

      running = true;
      resetResult();
      button.disabled = true;
      setStatus('Menyiapkan slide asli dan presenter…');
      setProgress(4, 'Menyiapkan');

      const selected = await chooseVideoProvider(1);
      providerNotice(selected.provider, selected.model);
      const jobIds = [];

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        setStatus(`Membuat presenter untuk Slide ${entry.index + 1} tanpa mengubah gambar slide…`);
        const jobId = await createPresenterJob(entry, selected);
        jobIds.push(jobId);
        await waitForJob(jobId, entry, index, entries.length);
      }

      setStatus('Semua suara/presenter selesai. Menyusun slide asli menjadi video final…');
      setProgress(84, 'Menyusun video');
      const composed = await api('/api/presenter-video/compose', {
        method: 'POST',
        body: JSON.stringify({
          contentId: activeContent.id,
          jobIds,
          audioOnlySlides: entries.filter(entry => entry.audioOnly).map(entry => entry.index + 1)
        })
      });

      const video = $('#presenter-video-preview');
      const result = $('#presenter-video-result');
      const download = $('#presenter-video-download');
      video.src = composed.resultUrl;
      result.classList.remove('hidden');
      download.href = composed.downloadUrl;
      setProgress(100, 'Selesai');
      setStatus('Video selesai. Gambar setiap slide tetap memakai hasil Text Content yang sama.');
    } catch (error) {
      setStatus(error.message, true);
      setProgress(0, 'Gagal');
    } finally {
      running = false;
      button.disabled = false;
    }
  }

  function openDialog() {
    if (!activeContent?.id) {
      setStatus('Pilih hasil Text Content terlebih dahulu.', true);
      return;
    }
    $('#presenter-video-content-title').textContent = activeContent.topic || activeContent.main_topic || 'Text Content';
    renderSlidePlan();
    renderPresenter();
    resetResult();
    const dialog = $('#presenter-video-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function closeDialog() {
    const dialog = $('#presenter-video-dialog');
    if (dialog?.open && typeof dialog.close === 'function') dialog.close(); else dialog?.removeAttribute('open');
  }

  function installDialog() {
    if ($('#presenter-video-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'presenter-video-dialog';
    dialog.className = 'project-dialog';
    dialog.setAttribute('aria-labelledby', 'presenter-video-title');
    dialog.innerHTML = `
      <div class="dialog-heading">
        <div><span class="eyebrow">AUTOMATIC VIDEO</span><h2 id="presenter-video-title">Buat Video dari Slide</h2></div>
        <button id="presenter-video-close" class="icon-button" type="button" aria-label="Tutup">✕</button>
      </div>
      <div class="presenter-video-body">
        <section class="presenter-slide-plan">
          <small>TEXT CONTENT</small>
          <b id="presenter-video-content-title"></b>
          <p id="presenter-video-plan-note"></p>
          <div id="presenter-video-slides"></div>
        </section>

        <section>
          <label class="presenter-section-label">Presenter</label>
          <div id="presenter-video-presenter" class="presenter-picked"></div>
          <div class="presenter-picker-actions">
            <button id="presenter-video-pick" class="outline" type="button">Pilih dari Asset</button>
            <button id="presenter-video-upload" class="outline" type="button">Unggah dari perangkat</button>
            <input id="presenter-video-file" type="file" accept="image/*" hidden>
          </div>
          <small class="presenter-image-hint">Gunakan satu foto yang hanya berisi satu presenter/karakter. Jangan gunakan kolase banyak pose karena model dapat membuat banyak karakter sekaligus.</small>
        </section>

        <div class="presenter-options-grid">
          <label>Template<select id="presenter-video-template"><option value="clean">Clean</option><option value="news">News</option><option value="casual">Casual</option><option value="cinematic">Cinematic</option></select></label>
          <label>Gaya suara<select id="presenter-video-voice"><option value="natural">Natural Indonesia</option><option value="calm">Tenang</option><option value="news">News</option><option value="energetic">Energik</option></select></label>
        </div>

        <div class="presenter-layout-info">
          <b>Layout otomatis</b>
          <span>Slide 1, 2, dan 4: slide tetap ditampilkan + presenter berbicara di bawah.</span>
          <span>Slide 3: slide tampil penuh + suara saja.</span>
          <span>Tidak ada B-roll atau gambar baru yang mengganti slide.</span>
        </div>

        <label class="presenter-rights"><input id="presenter-video-rights" type="checkbox"> <span>Saya berhak menggunakan foto presenter ini dan, jika menampilkan orang nyata, presenter tersebut adalah orang dewasa. Saya memahami provider video dapat menggunakan kuota/biaya yang sudah terpasang di AI Ads Lab.</span></label>
        <small id="presenter-video-provider">Mesin presenter akan dipilih otomatis dari provider video yang mendukung gambar referensi.</small>
        <button id="presenter-video-generate" type="button">✦ Generate Video</button>
        <div class="presenter-progress-wrap">
          <progress id="presenter-video-progress" max="100" value="0"></progress>
          <div><small id="presenter-video-progress-label">Siap</small><small id="presenter-video-status" role="status"></small></div>
        </div>
        <div id="presenter-video-result" class="hidden presenter-result">
          <video id="presenter-video-preview" controls playsinline preload="metadata"></video>
          <div><a id="presenter-video-download" class="button" download>↓ Simpan MP4</a><button id="presenter-video-regenerate" class="outline" type="button">↻ Generate Ulang</button></div>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    $('#presenter-video-close').onclick = closeDialog;
    $('#presenter-video-pick').onclick = () => pickPresenter().catch(error => setStatus(error.message, true));
    $('#presenter-video-upload').onclick = () => $('#presenter-video-file').click();
    $('#presenter-video-file').onchange = event => {
      const file = event.target.files?.[0];
      if (file) uploadPresenter(file).catch(error => setStatus(error.message, true));
      event.target.value = '';
    };
    $('#presenter-video-generate').onclick = generateVideo;
    $('#presenter-video-regenerate').onclick = generateVideo;
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!running) closeDialog(); });
    dialog.addEventListener('click', event => { if (event.target === dialog && !running) closeDialog(); });
  }

  function installButton() {
    if ($('#presenter-video-open')) return;
    const uploadButton = $('#upload');
    if (!uploadButton) return;
    const button = document.createElement('button');
    button.id = 'presenter-video-open';
    button.type = 'button';
    button.textContent = '🎬 Buat Video';
    button.style.width = '100%';
    button.style.marginBottom = '10px';
    button.onclick = openDialog;
    uploadButton.before(button);
  }

  function wrapShow() {
    if (typeof window.show !== 'function') return false;
    if (window.show.__presenterVideoAware) return true;
    const original = window.show;
    const wrapped = function presenterVideoAwareShow(item) {
      activeContent = item || null;
      const result = original(item);
      const button = $('#presenter-video-open');
      if (button) button.disabled = !item?.id;
      return result;
    };
    wrapped.__presenterVideoAware = true;
    window.show = wrapped;
    return true;
  }

  function install() {
    if (installed) return;
    installed = true;
    installDialog();
    installButton();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      installButton();
      if (wrapShow() || attempts >= 30) clearInterval(timer);
    }, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
