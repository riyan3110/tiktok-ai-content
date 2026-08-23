(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__AIADS_PRESENTER_VIDEO_ADDON__) return;
  window.__AIADS_PRESENTER_VIDEO_ADDON__ = true;

  const $ = selector => document.querySelector(selector);
  const terminal = new Set(['Completed', 'Failed', 'Cancelled']);
  const providerPriority = ['google-veo', 'zark', 'vidu', '9router', 'orcarouter', 'google-flow', 'omni'];
  let activeContent = null;
  let presenterAsset = null;
  let activeJobId = '';
  let pollTimer = null;
  let installed = false;

  const safe = value => {
    const node = document.createElement('span');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  };

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

  function buildNarration(item) {
    const candidates = [item?.hook, item?.body, item?.cta]
      .map(normalizeSpokenText)
      .filter(Boolean);
    const unique = [];
    for (const text of candidates) {
      if (!unique.some(previous => previous === text || previous.includes(text))) unique.push(text);
    }
    return unique.join(' ').trim();
  }

  function styleInstruction(template) {
    return ({
      clean: 'Clean contemporary vertical social-video look, soft natural light, uncluttered background, credible and realistic.',
      news: 'Modern short-form news presenter look, confident framing, restrained newsroom-inspired visual treatment, credible and realistic.',
      casual: 'Natural creator-style vertical video, relaxed but clear delivery, subtle handheld energy, realistic social-media aesthetic.',
      cinematic: 'Cinematic vertical presenter video with natural dramatic lighting, polished depth, controlled camera movement, still realistic.'
    })[template] || 'Clean contemporary vertical social-video look, credible and realistic.';
  }

  function voiceInstruction(voice) {
    return ({
      natural: 'Speak Indonesian naturally, conversationally, with human pacing, small pauses, and no announcer-like exaggeration.',
      calm: 'Speak Indonesian calmly and warmly, with measured pacing and natural pauses.',
      news: 'Speak Indonesian clearly in a professional news-explainer tone, confident but not theatrical.',
      energetic: 'Speak Indonesian with lively social-video energy while keeping pronunciation natural and controlled.'
    })[voice] || 'Speak Indonesian naturally with human pacing and clear pronunciation.';
  }

  function buildVideoPrompt() {
    const narration = buildNarration(activeContent);
    const template = $('#presenter-video-template')?.value || 'clean';
    const voice = $('#presenter-video-voice')?.value || 'natural';
    const broll = $('#presenter-video-broll')?.checked;
    const subtitles = $('#presenter-video-subtitles')?.checked;
    const music = $('#presenter-video-music')?.checked;
    const exactSpeech = narration.slice(0, 3600);

    return [
      'Create a polished 9:16 vertical AI presenter video using the supplied presenter image as the identity reference.',
      'Keep the same face, hair, clothing identity, skin tone, and overall appearance throughout. Use subtle blinking, small head movement, restrained facial expression, and realistic mouth movement. Avoid exaggerated gestures and avoid identity drift.',
      styleInstruction(template),
      voiceInstruction(voice),
      'The presenter must speak the supplied Indonesian narration. Preserve factual meaning and do not add claims, numbers, names, or conclusions that are not present in the narration.',
      broll ? 'Use brief relevant B-roll or visual cutaways only where they genuinely clarify the spoken point, then return to the same presenter. Do not replace the presenter identity.' : 'Keep the presenter as the main visual for the whole clip; do not add unrelated B-roll.',
      subtitles ? 'If the selected model supports reliable native captions, add clean readable Indonesian subtitles synchronized to the speech. Do not invent or paraphrase subtitle text.' : 'Do not render subtitles into the generated picture.',
      music ? 'If the selected model supports native audio mixing, add very soft unobtrusive background music under the voice; speech must remain clearly dominant.' : 'Do not add background music.',
      'Do not add logos, watermarks, labels, UI, fake headlines, or extra on-screen text. Keep camera movement gentle and suitable for TikTok/Reels.',
      `Narration to speak exactly in Indonesian:\n"${exactSpeech.replace(/"/g, '\\"')}"`
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
    const providers = (await api('/api/content-studio/providers')).filter(provider => provider.types?.includes('video'));
    if (!providers.length) throw new Error('Belum ada provider video aktif. Text Content tetap bisa digunakan seperti biasa.');

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
    throw new Error('Provider video aktif belum memiliki model video yang bisa dipakai.');
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
    activeJobId = '';
    clearTimeout(pollTimer);
    pollTimer = null;
    setProgress(0, 'Siap');
  }

  function renderPresenter() {
    const host = $('#presenter-video-presenter');
    if (!host) return;
    if (!presenterAsset) {
      host.innerHTML = '<span style="color:var(--muted)">Belum ada presenter dipilih.</span>';
      return;
    }
    host.innerHTML = `<img src="${safe(presenterAsset.previewUrl || presenterAsset.preview_url || `/api/assets/${encodeURIComponent(presenterAsset.id)}/preview`)}" alt="Presenter" style="width:54px;height:54px;object-fit:cover;border-radius:12px;border:1px solid var(--border)"><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(presenterAsset.name)}</b><small style="color:var(--muted)">Presenter terpilih</small></div>`;
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
    node.textContent = `Mesin otomatis: ${provider.name || provider.id} · ${model}`;
  }

  async function pollJob(id) {
    clearTimeout(pollTimer);
    try {
      const job = await api(`/api/content-studio/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      setProgress(job.progress ?? 35, job.status || 'Memproses…');
      if (job.status === 'Completed') {
        if (job.result_missing || !job.result_url) throw new Error('Provider selesai, tetapi file video hasil tidak tersedia.');
        const video = $('#presenter-video-preview');
        const result = $('#presenter-video-result');
        const download = $('#presenter-video-download');
        video.src = job.result_url;
        result.classList.remove('hidden');
        download.href = `/api/content-studio/jobs/${encodeURIComponent(id)}/download`;
        setStatus('Video selesai. Hasil final langsung siap dipreview.');
        setProgress(100, 'Selesai');
        $('#presenter-video-generate').disabled = false;
        return;
      }
      if (terminal.has(job.status)) throw new Error(job.error_message || `Generate video ${String(job.status || '').toLowerCase()}.`);
      pollTimer = setTimeout(() => pollJob(id), 1800);
    } catch (error) {
      setStatus(error.message, true);
      setProgress(100, 'Gagal');
      $('#presenter-video-generate').disabled = false;
    }
  }

  async function generateVideo() {
    const button = $('#presenter-video-generate');
    try {
      if (!activeContent?.id) throw new Error('Pilih hasil Text Content terlebih dahulu.');
      if (!presenterAsset) throw new Error('Pilih satu foto presenter terlebih dahulu.');
      if (!$('#presenter-video-rights')?.checked) throw new Error('Konfirmasi hak penggunaan foto presenter terlebih dahulu.');
      const narration = buildNarration(activeContent);
      if (!narration) throw new Error('Text Content belum memiliki naskah yang bisa dijadikan narasi.');

      resetResult();
      button.disabled = true;
      setStatus('Menyiapkan video otomatis…');
      setProgress(5, 'Menyiapkan');

      const selected = await chooseVideoProvider(1);
      providerNotice(selected.provider, selected.model);
      setStatus('Mengirim naskah dan presenter ke mesin video…');
      setProgress(10, 'Mengirim');

      const response = await api('/api/content-studio/generate', {
        method: 'POST',
        body: JSON.stringify({
          provider: selected.provider.id,
          model: selected.model,
          prompt: buildVideoPrompt(),
          mediaType: 'video',
          promptSource: 'manual',
          assetIds: [presenterAsset.id],
          resolution: '1080p',
          aspectRatio: '9:16',
          count: 1,
          metadata: {
            feature: 'presenter-video',
            contentId: activeContent.id,
            narration,
            template: $('#presenter-video-template')?.value || 'clean',
            voiceStyle: $('#presenter-video-voice')?.value || 'natural',
            autoBroll: Boolean($('#presenter-video-broll')?.checked),
            autoSubtitles: Boolean($('#presenter-video-subtitles')?.checked),
            autoMusic: Boolean($('#presenter-video-music')?.checked)
          }
        })
      });
      activeJobId = response.ids?.[0] || response.id || '';
      if (!activeJobId) throw new Error('Job video tidak berhasil dibuat.');
      setStatus('Video sedang dibuat. Kamu tidak perlu mengedit scene satu per satu.');
      await pollJob(activeJobId);
    } catch (error) {
      button.disabled = false;
      setStatus(error.message, true);
      setProgress(0, 'Gagal memulai');
    }
  }

  function openDialog() {
    if (!activeContent?.id) {
      setStatus('Pilih hasil Text Content terlebih dahulu.', true);
      return;
    }
    const dialog = $('#presenter-video-dialog');
    const narration = buildNarration(activeContent);
    $('#presenter-video-content-title').textContent = activeContent.topic || activeContent.main_topic || 'Text Content';
    $('#presenter-video-narration').textContent = narration || 'Belum ada narasi.';
    renderPresenter();
    resetResult();
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function closeDialog() {
    clearTimeout(pollTimer);
    pollTimer = null;
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
        <div><span class="eyebrow">AUTOMATIC VIDEO</span><h2 id="presenter-video-title">Buat Video Presenter</h2></div>
        <button id="presenter-video-close" class="icon-button" type="button" aria-label="Tutup">✕</button>
      </div>
      <div style="display:grid;gap:14px">
        <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
          <small style="color:var(--muted)">TEXT CONTENT</small>
          <b id="presenter-video-content-title" style="display:block;margin-top:3px"></b>
          <p id="presenter-video-narration" style="margin:8px 0 0;max-height:92px;overflow:auto;color:var(--muted);font-size:.82rem;line-height:1.5"></p>
        </div>
        <div>
          <label style="display:block;margin-bottom:7px;font-weight:700">Presenter</label>
          <div id="presenter-video-presenter" style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:12px;margin-bottom:8px"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="presenter-video-pick" class="outline" type="button">Pilih dari Asset</button>
            <button id="presenter-video-upload" class="outline" type="button">Unggah dari perangkat</button>
            <input id="presenter-video-file" type="file" accept="image/*" hidden>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          <label>Template<select id="presenter-video-template"><option value="clean">Clean</option><option value="news">News</option><option value="casual">Casual</option><option value="cinematic">Cinematic</option></select></label>
          <label>Gaya suara<select id="presenter-video-voice"><option value="natural">Natural Indonesia</option><option value="calm">Tenang</option><option value="news">News</option><option value="energetic">Energik</option></select></label>
        </div>
        <div style="display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:12px">
          <label style="display:flex;align-items:center;gap:8px"><input id="presenter-video-broll" type="checkbox" checked> B-roll otomatis</label>
          <label style="display:flex;align-items:center;gap:8px"><input id="presenter-video-subtitles" type="checkbox" checked> Subtitle otomatis jika model mendukung</label>
          <label style="display:flex;align-items:center;gap:8px"><input id="presenter-video-music" type="checkbox"> Musik otomatis jika model mendukung</label>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:.8rem;color:var(--muted)"><input id="presenter-video-rights" type="checkbox" style="margin-top:2px"> Saya berhak menggunakan foto presenter ini dan, jika menampilkan orang nyata, presenter tersebut adalah orang dewasa. Saya memahami provider video dapat menggunakan kuota/biaya yang sudah terpasang di AI Ads Lab.</label>
        <small id="presenter-video-provider" style="color:var(--muted)">Mesin video akan dipilih otomatis dari provider yang sudah aktif.</small>
        <button id="presenter-video-generate" type="button" style="width:100%">✦ Generate Video</button>
        <div style="display:grid;gap:6px">
          <progress id="presenter-video-progress" max="100" value="0" style="width:100%"></progress>
          <div style="display:flex;justify-content:space-between;gap:8px"><small id="presenter-video-progress-label" style="color:var(--muted)">Siap</small><small id="presenter-video-status" role="status" style="color:var(--muted);text-align:right"></small></div>
        </div>
        <div id="presenter-video-result" class="hidden" style="display:grid;gap:10px">
          <video id="presenter-video-preview" controls playsinline preload="metadata" style="width:100%;max-height:58vh;background:#000;border-radius:14px"></video>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a id="presenter-video-download" class="button" download>↓ Simpan MP4</a>
            <button id="presenter-video-regenerate" class="outline" type="button">↻ Generate Ulang</button>
          </div>
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
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
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
