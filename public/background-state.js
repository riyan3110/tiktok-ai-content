((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CarouselBackgroundState = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const BLACK = '#0B0B0D';
  const DEFAULT = Object.freeze({ type: 'color', color: BLACK, assetId: null, previewUrl: null, textColor: '#FFFFFF', applyToAllSlides: true, slideBackgrounds: {}, uploadedBackground: null });
  const copy = state => { const uploadedBackground = state?.uploadedBackground || (state?.type === 'image' && state.assetId ? { assetId: state.assetId, previewUrl: state.previewUrl, textColor: state.textColor || '#FFFFFF' } : null); return { ...DEFAULT, ...(state || {}), slideBackgrounds: { ...(state?.slideBackgrounds || {}) }, uploadedBackground: uploadedBackground ? { ...uploadedBackground } : null }; };
  const selectColor = (state, color, textColor = color === BLACK ? '#FFFFFF' : '#000000') => ({ ...copy(state), type: 'color', color, assetId: null, previewUrl: null, textColor });
  const upload = (state, uploadedBackground) => ({ ...copy(state), type: 'image', color: state?.color || BLACK, ...uploadedBackground, uploadedBackground: { ...uploadedBackground } });
  const activateUpload = state => state?.uploadedBackground ? upload(state, state.uploadedBackground) : copy(state);
  const removeUpload = state => {
    const next = copy(state);
    for (const [key, background] of Object.entries(next.slideBackgrounds)) if (background?.type === 'image') delete next.slideBackgrounds[key];
    if (next.type === 'image') Object.assign(next, { type: 'color', color: BLACK, assetId: null, previewUrl: null, textColor: '#FFFFFF' });
    next.uploadedBackground = null;
    return next;
  };
  const reset = state => ({ ...selectColor(state, BLACK), applyToAllSlides: true, slideBackgrounds: {} });
  const setSlide = (state, index, choice) => {
    const next = copy(state);
    if (!choice) delete next.slideBackgrounds[index];
    else if (choice === 'image' && next.uploadedBackground) next.slideBackgrounds[index] = { type: 'image', color: next.color, ...next.uploadedBackground };
    else if (/^#[0-9a-f]{6}$/i.test(choice)) next.slideBackgrounds[index] = { type: 'color', color: choice, assetId: null, previewUrl: null, textColor: choice === BLACK ? '#FFFFFF' : '#000000' };
    return next;
  };
  const previews = (state, count) => Array.from({ length: count }, (_, index) => state.applyToAllSlides ? state : (state.slideBackgrounds[index] || state));
  return { BLACK, DEFAULT, copy, selectColor, upload, activateUpload, removeUpload, reset, setSlide, previews };
});

(() => {
  if (typeof document === 'undefined') return;
  const originalField = document.querySelector('#manual-topic-field');
  const originalInput = originalField?.querySelector('#manual-topic');
  const manualRadio = document.querySelector('input[name="topic-source"][value="manual"]');
  const withoutRadio = document.querySelector('input[name="source-mode"][value="without"]');
  const withRadio = document.querySelector('input[name="source-mode"][value="with"]');
  if (!originalField || !originalInput || !manualRadio || !withoutRadio || !withRadio) return;

  const withoutLabel = withoutRadio.closest('label')?.querySelector('span');
  const legend = document.querySelector('#source-mode-wrap legend');
  const textField = document.createElement('label');
  textField.id = 'text-generate-field';
  textField.className = 'hidden';
  textField.innerHTML = 'Teks / ringkasan berita<textarea id="manual-text-input" rows="9" maxlength="20000" placeholder="Tempel ringkasan atau teks berita di sini. AI Ads Lab hanya akan menyusun isi teks ini menjadi carousel 4–5 slide."></textarea><small>Generate dari Teks tidak mencari sumber dan tidak menambah fakta dari luar teks yang kamu tempel.</small>';
  originalField.after(textField);
  const textInput = textField.querySelector('textarea');

  const sync = () => {
    const manualMode = manualRadio.checked;
    const textMode = manualMode && withoutRadio.checked;
    if (withoutLabel) withoutLabel.textContent = manualMode ? 'Generate dari Teks' : 'Tanpa URL';
    if (legend) legend.textContent = manualMode ? 'Mode Konten' : 'Sumber URL';
    originalField.classList.toggle('hidden', textMode);
    textField.classList.toggle('hidden', !textMode);
    if (textMode) {
      originalInput.id = 'manual-topic-url';
      textInput.id = 'manual-topic';
    } else {
      textInput.id = 'manual-text-input';
      originalInput.id = 'manual-topic';
    }
  };

  document.querySelectorAll('input[name="source-mode"],input[name="topic-source"]').forEach(input => input.addEventListener('change', sync));
  sync();
})();
