const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');

const escapeXml = (value) => String(value).replace(/[<>&'\"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function wrap(text, max = 28) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const word of words) { if (`${line} ${word}`.trim().length > max) { lines.push(line); line = word; } else line = `${line} ${word}`.trim(); }
  if (line) lines.push(line); return lines.slice(0, 13);
}
function svg(title, text, number) {
  const lines = wrap(text, number === 2 ? 34 : 27);
  const size = number === 2 ? 48 : 66;
  const tspans = lines.map((line, i) => `<tspan x="100" dy="${i ? size * 1.3 : 0}">${escapeXml(line)}</tspan>`).join('');
  return `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#15122d"/><stop offset="1" stop-color="#5b21b6"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="940" cy="190" r="260" fill="#ec4899" opacity=".28"/><text x="100" y="190" fill="#f9a8d4" font-family="Arial,sans-serif" font-size="34" font-weight="700">AI ADS LAB • ${number}/3</text><text x="100" y="330" fill="white" font-family="Arial,sans-serif" font-size="52" font-weight="700">${escapeXml(title)}</text><text x="100" y="520" fill="white" font-family="Arial,sans-serif" font-size="${size}" font-weight="700">${tspans}</text><text x="100" y="1780" fill="#ddd6fe" font-family="Arial,sans-serif" font-size="30">Simpan untuk dipraktikkan nanti ✦</text></svg>`;
}
async function createSlides(id, content) {
  const dir = path.join(config.root, 'public/generated'); await fs.mkdir(dir, { recursive: true });
  const values = [['HOOK', content.hook], ['LANGKAH PRAKTIS', content.body], ['SIAP COBA?', `${content.topic}\n\n${content.cta}`]];
  const files = [];
  for (let i = 0; i < values.length; i++) {
    const name = `${id}-${i + 1}.png`; await sharp(Buffer.from(svg(...values[i], i + 1))).png().toFile(path.join(dir, name)); files.push(`/generated/${name}`);
  }
  return files;
}
module.exports = { createSlides, wrap };
