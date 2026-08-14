const SECTION_HEADER = /^(?:SLIDE\s*[1-4]\s*(?:[-–—:]\s*)?(?:HOOK|FAKTA\s+UTAMA|DETAIL|PENUTUP)|HOOK|FAKTA\s+UTAMA|DETAIL|PENUTUP|CAPTION|HASHTAGS?|TAGAR)\s*$/i;
const BULLET_LINE = /^(?:[•●▪◦‣*+\-–—]|\d{1,2}[.)])\s+(.+)$/u;
const INLINE_BULLET_MARKER = /(?:^|\s)([•●▪◦‣*+]|\d{1,2}[.)])\s+/gu;

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitInlineBullets(rawLine) {
  const line = String(rawLine || '').trim();
  if (!BULLET_LINE.test(line)) return [line];
  const matches = [...line.matchAll(INLINE_BULLET_MARKER)];
  if (matches.length <= 1) return [line];

  const parts = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
    const value = line.slice(start, end).replace(/\s+/g, ' ').trim();
    if (value) parts.push(`• ${value}`);
  }
  return parts.length ? parts : [line];
}

function looksStructured(value) {
  const source = normalizeText(value);
  return /(?:^|\n)\s*SLIDE\s*1\s*(?:[-–—:]\s*)?HOOK\s*(?:\n|$)/i.test(source)
    && /(?:^|\n)\s*SLIDE\s*4\s*(?:[-–—:]\s*)?PENUTUP\s*(?:\n|$)/i.test(source);
}

function formatCarouselPaste(value) {
  const lines = normalizeText(value)
    .split('\n')
    .flatMap(splitInlineBullets)
    .map(line => String(line || '').trim())
    .filter(Boolean);

  const output = [];
  let plainCount = 0;
  let previousWasBullet = false;

  const blank = () => {
    if (output.length && output[output.length - 1] !== '') output.push('');
  };

  for (const line of lines) {
    if (SECTION_HEADER.test(line)) {
      blank();
      output.push(line, '');
      plainCount = 0;
      previousWasBullet = false;
      continue;
    }

    const bullet = line.match(BULLET_LINE);
    if (bullet) {
      if (!previousWasBullet) blank();
      output.push(`• ${bullet[1].replace(/\s+/g, ' ').trim()}`);
      previousWasBullet = true;
      continue;
    }

    if (previousWasBullet) blank();
    if (plainCount > 0) blank();
    output.push(line.replace(/\s+/g, ' ').trim());
    plainCount += 1;
    previousWasBullet = false;
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function install() {
  document.addEventListener('paste', event => {
    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement) || !input.closest('#text-generate-field')) return;
    const pasted = event.clipboardData?.getData('text/plain') || '';
    if (!looksStructured(pasted)) return;

    event.preventDefault();
    const formatted = formatCarouselPaste(pasted);
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(formatted, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

if (typeof document !== 'undefined') install();

if (typeof module === 'object' && module.exports) {
  module.exports = { normalizeText, splitInlineBullets, looksStructured, formatCarouselPaste };
}
