const CONTENT_CATEGORIES = Object.freeze([
  'Iklan & UGC', 'Tutorial AI', 'Tips bisnis', 'Produktivitas', 'Fakta unik',
  'Edukasi teknologi', 'Motivasi', 'Konten kreator'
]);
const CONTENT_FORMATS = Object.freeze([
  'Tutorial langkah', 'Listicle', 'Fakta singkat', 'Masalah dan solusi',
  'Before-after', 'Tips cepat'
]);

function resolveCategory(category, customCategory) {
  if (category === 'Custom') {
    const value = String(customCategory || '').trim().replace(/\s+/g, ' ');
    if (!value) throw invalid('Kategori custom wajib diisi');
    if (value.length > 80) throw invalid('Kategori custom maksimal 80 karakter');
    return value;
  }
  if (!CONTENT_CATEGORIES.includes(category)) throw invalid('Kategori konten tidak valid');
  return category;
}

function resolveFormat(format) {
  if (!CONTENT_FORMATS.includes(format)) throw invalid('Format konten tidak valid');
  return format;
}

function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

module.exports = { CONTENT_CATEGORIES, CONTENT_FORMATS, resolveCategory, resolveFormat };
