// Content layout templates for the Text Content carousel.
// "default" MUST stay a no-op: it preserves the legacy prompt, validation,
// renderer, and stored content behavior exactly. Older content without a layout
// therefore continues to use the existing carousel unchanged.

const LAYOUTS = {
  default: {
    id: 'default',
    label: 'Default',
    icon: 'layout',
    structureInstruction: '',
    writerInstruction: '',
    rendererStyle: 'default'
  },
  tutorial: {
    id: 'tutorial',
    label: 'Tutorial',
    icon: 'steps',
    structureInstruction: 'TATA LETAK TUTORIAL: Susun materi sebagai proses yang benar-benar berurutan, bukan sekadar mengganti label section. Gunakan 4–5 slide: PEMBUKA/HOOK, LANGKAH 1, LANGKAH 2 dan langkah lanjutan bila memang dibutuhkan, lalu HASIL/PENUTUP. Urutkan tindakan dari prasyarat ke tindakan utama lalu pengecekan hasil. Jangan melompati tahapan penting dan jangan mengulang satu tindakan di dua slide.',
    writerInstruction: 'Kalimat tutorial harus instruktif, jelas, dan natural. Setiap slide fokus pada satu langkah utama. Body berisi instruksi inti yang enak dibaca, sedangkan points hanya untuk maksimal dua tindakan pendukung yang benar-benar perlu dan akan ditampilkan sebagai kartu langkah bernomor, bukan bullet. Nomor langkah berasal dari urutan proses, bukan dekorasi. Jika bahan tidak benar-benar berupa prosedur, jangan mengarang langkah; ubah menjadi urutan penjelasan paling masuk akal yang tetap setia pada fakta yang tersedia.',
    rendererStyle: 'tutorial'
  },
  story: {
    id: 'story',
    label: 'Cerita',
    icon: 'story',
    structureInstruction: 'TATA LETAK CERITA: Susun 4–5 slide sebagai alur naratif yang menyambung dari slide ke slide: PEMBUKA CERITA/HOOK, SITUASI AWAL, PERKEMBANGAN atau KEJADIAN UTAMA, lalu PENYELESAIAN/MAKNA/PENUTUP. Jangan membuat daftar fakta yang berdiri sendiri dan jangan memakai penomoran langkah.',
    writerInstruction: 'Kalimat cerita harus terasa seperti satu kisah yang terus bergerak. Gunakan transisi waktu atau hubungan kejadian hanya bila memang didukung materi. Jangan menciptakan tokoh, pengalaman pribadi, emosi, sebab-akibat, atau detail kejadian yang tidak tersedia. Utamakan body berupa paragraf naratif utuh. Jika points terpaksa dipakai karena struktur data, isinya harus berupa lanjutan paragraf pendek dan tidak boleh ditulis sebagai daftar atau bullet.',
    rendererStyle: 'story'
  },
  news: {
    id: 'news',
    label: 'Berita',
    icon: 'news',
    structureInstruction: 'TATA LETAK BERITA: Susun 4–5 slide dengan pola piramida terbalik: HEADLINE, FAKTA UTAMA/APA YANG TERJADI, KONTEKS atau DETAIL PENTING, lalu PERKEMBANGAN TERAKHIR/APA SELANJUTNYA/PENUTUP. Informasi terpenting harus muncul lebih awal. Jangan memakai struktur tutorial atau storytelling dramatis.',
    writerInstruction: 'Kalimat berita harus ringkas, netral, dan faktual. Headline menjadi fokus utama, body menjadi ringkasan berita, dan maksimal dua points dipakai sebagai fakta pendukung yang akan ditampilkan sebagai kartu FAKTA, bukan bullet. Bedakan fakta dari konteks; hindari opini, asumsi motif, clickbait, dan bahasa dramatis. Untuk angka, nama, tanggal, kutipan, status, atau perkembangan terbaru, gunakan hanya informasi yang tersedia pada sumber/input. Jika sumber tidak mendukung suatu detail, jangan menambahkannya.',
    rendererStyle: 'news'
  }
};

const LAYOUT_IDS = Object.keys(LAYOUTS);

function resolveContentLayout(value) {
  const id = String(value || '').trim().toLowerCase();
  return LAYOUTS[id] ? id : 'default';
}

function layoutInstruction(value) {
  const layout = LAYOUTS[resolveContentLayout(value)];
  if (!layout || layout.id === 'default') return '';
  return [layout.structureInstruction, layout.writerInstruction].filter(Boolean).join(' ');
}

function layoutRendererStyle(value) {
  const layout = LAYOUTS[resolveContentLayout(value)];
  return layout ? layout.rendererStyle : 'default';
}

// Existing Content Format remains untouched for Default. Non-default layouts
// need a compatible validator/source-finalizer format so the hidden legacy
// "Tutorial langkah" default cannot force story/news back into numbered steps.
function contentFormatForLayout(value, fallback = 'Tutorial langkah') {
  const layout = resolveContentLayout(value);
  if (layout === 'tutorial') return 'Tutorial langkah';
  if (layout === 'story' || layout === 'news') return 'Fakta singkat';
  return fallback;
}

function validateLayoutSlides(value, slides = []) {
  const layout = resolveContentLayout(value);
  if (layout === 'default' || !Array.isArray(slides)) return [];
  const errors = [];
  const sections = slides.map(slide => String(slide?.section || '').trim());
  const copy = slides.map(slide => [slide?.section, slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])].filter(Boolean).join(' '));

  if (layout === 'tutorial') {
    const numbered = sections.map(section => section.match(/LANGKAH\s*(\d+)/i)).filter(Boolean).map(match => Number(match[1]));
    if (!numbered.length) errors.push('Tata letak Tutorial wajib memiliki section LANGKAH bernomor.');
    numbered.forEach((number, index) => {
      if (number !== index + 1) errors.push(`Tata letak Tutorial: urutan LANGKAH harus mulai dari 1 tanpa loncat; ditemukan ${numbered.join(', ')}.`);
    });
  }

  if (layout === 'story') {
    if (copy.some(text => /\bLANGKAH\s*\d+\b|(?:^|\s)\d+[.)]\s+/i.test(text))) errors.push('Tata letak Cerita tidak boleh memakai langkah bernomor.');
    if (sections.length && !/PEMBUKA|HOOK|CERITA/i.test(sections[0])) errors.push('Tata letak Cerita harus dimulai dengan PEMBUKA CERITA/HOOK.');
    if (sections.length && !/PENYELESAIAN|MAKNA|PENUTUP|AKHIR/i.test(sections.at(-1))) errors.push('Tata letak Cerita harus berakhir dengan PENYELESAIAN/MAKNA/PENUTUP.');
  }

  if (layout === 'news') {
    if (copy.some(text => /\bLANGKAH\s*\d+\b|(?:^|\s)\d+[.)]\s+/i.test(text))) errors.push('Tata letak Berita tidak boleh memakai langkah bernomor.');
    if (sections.length && !/HEADLINE|PEMBUKA|BERITA/i.test(sections[0])) errors.push('Tata letak Berita harus dimulai dengan HEADLINE.');
    if (!sections.some(section => /FAKTA|DETAIL|KONTEKS|PERKEMBANGAN/i.test(section))) errors.push('Tata letak Berita harus memiliki FAKTA/DETAIL/KONTEKS.');
  }
  return [...new Set(errors)];
}

function layoutSections(value, count = 4) {
  const layout = resolveContentLayout(value);
  const size = Math.min(5, Math.max(4, Number(count) || 4));
  if (layout === 'tutorial') {
    const middle = Array.from({ length: size - 2 }, (_, index) => `LANGKAH ${index + 1}`);
    return ['PEMBUKA', ...middle, 'HASIL/PENUTUP'];
  }
  if (layout === 'story') {
    return size === 5
      ? ['PEMBUKA CERITA', 'SITUASI', 'PERKEMBANGAN', 'KEJADIAN UTAMA', 'PENYELESAIAN']
      : ['PEMBUKA CERITA', 'SITUASI', 'PERKEMBANGAN', 'PENYELESAIAN'];
  }
  if (layout === 'news') {
    return size === 5
      ? ['HEADLINE', 'FAKTA UTAMA', 'KONTEKS', 'DETAIL PENTING', 'PERKEMBANGAN']
      : ['HEADLINE', 'FAKTA UTAMA', 'KONTEKS/DETAIL', 'PERKEMBANGAN'];
  }
  return null;
}

module.exports = {
  LAYOUTS,
  LAYOUT_IDS,
  resolveContentLayout,
  layoutInstruction,
  layoutRendererStyle,
  contentFormatForLayout,
  layoutSections,
  validateLayoutSlides
};
