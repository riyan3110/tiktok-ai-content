(() => {
  'use strict';
  if (window.__AIADS_GOOGLE_STUDIO_PRESERVED__) return;
  window.__AIADS_GOOGLE_STUDIO_PRESERVED__ = true;

  const $ = selector => document.querySelector(selector);

  function mountPromptGenerator() {
    const section = $('#prompt-generator');
    if (!section || section.dataset.googleStudioPrompt === 'true') return;
    section.dataset.googleStudioPrompt = 'true';
    section.innerHTML = `
      <div class="generator-heading">
        <div>
          <span class="eyebrow">PROMPT GENERATOR</span>
          <h1 id="generator-title">Buat Prompt dengan AI</h1>
          <p>Susun prompt final otomatis dari Permintaan, Konsisten, Produk, dan Foto Referensi — memakai Text AI yang sudah dikonfigurasi.</p>
        </div>
      </div>
      <form id="prompt-simple-form" class="generator-panel">
        <div class="generator-fields">
          <label>Permintaan<textarea id="prompt-permintaan" rows="3" required placeholder="Contoh: Video iklan produk untuk TikTok dengan suasana hangat"></textarea></label>
          <label>Konsisten<textarea id="prompt-konsisten" rows="2" placeholder="Elemen yang harus konsisten: karakter, logo, warna brand, gaya"></textarea></label>
          <label>Produk (opsional)<input id="prompt-produk" type="text" placeholder="Contoh: Kopi susu botol 250ml — Brand X"></label>
          <label>Foto Referensi (dari galeri perangkat)<input id="prompt-ref" type="file" accept="image/*"><div id="prompt-ref-preview" class="prompt-ref-preview"></div></label>
          <button id="prompt-buat" type="submit">Buat</button>
          <p id="prompt-buat-status" role="status"></p>
          <label>Hasil Prompt<textarea id="prompt-hasil" rows="8" readonly placeholder="Hasil prompt otomatis akan tampil di sini"></textarea></label>
        </div>
      </form>`;

    let refDataUrl = '';
    const refInput = $('#prompt-ref');
    const preview = $('#prompt-ref-preview');
    refInput?.addEventListener('change', () => {
      const file = refInput.files?.[0];
      if (!file) {
        refDataUrl = '';
        if (preview) preview.innerHTML = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        refDataUrl = String(reader.result || '');
        if (preview) preview.innerHTML = `<img class="prompt-ref-thumb" alt="Foto referensi" src="${refDataUrl}">`;
      };
      reader.readAsDataURL(file);
    });

    $('#prompt-simple-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const status = $('#prompt-buat-status');
      const output = $('#prompt-hasil');
      const button = $('#prompt-buat');
      const permintaan = $('#prompt-permintaan')?.value.trim() || '';
      if (!permintaan) {
        if (status) status.textContent = 'Isi kolom Permintaan terlebih dahulu.';
        return;
      }

      const konsisten = $('#prompt-konsisten')?.value.trim() || '';
      const produk = $('#prompt-produk')?.value.trim() || '';
      const instruction = [
        'Susun SATU prompt final untuk AI konten berdasarkan data berikut. Prompt harus rapi, detail, natural, dan langsung siap dipakai.',
        `Permintaan: ${permintaan}`,
        konsisten ? `Elemen yang harus konsisten di seluruh hasil: ${konsisten}` : 'Elemen konsisten: tidak ada yang ditentukan.',
        produk ? `Produk (masukkan informasi produk ini ke dalam prompt): ${produk}` : 'Produk: tidak ada. Jangan menyebut produk tertentu.',
        refDataUrl ? 'Foto referensi terlampir: gunakan detail visualnya (subjek, produk, suasana, gaya, warna) sebagai acuan utama penyusunan prompt.' : 'Foto referensi: tidak ada.',
        'Keluarkan hanya prompt final tanpa penjelasan tambahan.'
      ].join('\n');
      const messages = [{
        role: 'user',
        content: refDataUrl
          ? [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: refDataUrl } }]
          : instruction
      }];

      if (button) button.disabled = true;
      if (status) status.textContent = 'Menyusun prompt dengan Text AI…';
      if (output) output.value = '';
      try {
        const response = await fetch('/api/ai/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType: 'text', prompt: instruction, messages })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Gagal menyusun prompt.');
        const result = String(data.output || '').trim();
        if (!result) throw new Error('Provider tidak mengembalikan teks.');
        if (output) output.value = result;
        if (status) status.textContent = 'Prompt siap.';
      } catch (error) {
        if (status) status.textContent = `Gagal: ${error.message}`;
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPromptGenerator, { once: true });
  } else {
    mountPromptGenerator();
  }
})();
