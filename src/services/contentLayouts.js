// Content layout templates for the Text Content carousel.
// "default" MUST stay a no-op: it preserves the legacy prompt and renderer
// exactly, and it is the fallback for any stored content without a layout.

const LAYOUTS = {
  default: {
    id: 'default',
    label: 'Default',
    icon: 'layout',
    // Default must not add any instruction; the legacy prompt is canonical.
    structureInstruction: '',
    rendererStyle: 'default'
  },
  tutorial: {
    id: 'tutorial',
    label: 'Tutorial',
    icon: 'steps',
    structureInstruction: 'TATA LETAK TUTORIAL: Gunakan 4–5 slide dengan alur langkah yang jelas. Slide pertama adalah PEMBUKA berisi judul/hook tutorial dan janji hasil. Slide berikutnya adalah LANGKAH bernomor urut (LANGKAH 1, LANGKAH 2, dst.) yang masing-masing membahas satu tindakan konkret; jumlah slide langkah menyesuaikan kebutuhan isi secara wajar. Slide terakhir adalah PENUTUP berisi hasil akhir atau ringkasan tindakan. Nomor langkah harus terlihat, berurutan mulai dari 1, dan tidak ada langkah yang sama sekali tanpa isi.',
    rendererStyle: 'tutorial'
  },
  story: {
    id: 'story',
    label: 'Cerita',
    icon: 'story',
    structureInstruction: 'TATA LETAK CERITA: Gunakan 4–5 slide dengan alur naratif yang menyambung dari slide ke slide, bukan daftar fakta. Slide pertama adalah PEMBUKA/HOOK yang membangun rasa penasaran. Slide kedua membangun situasi awal cerita. Slide berikutnya memuat kejadian utama/konflik/perkembangan. Slide terakhir adalah penyelesaian atau makna cerita. Tulisan natural dan naratif, tetap ringkas untuk carousel, jangan terlalu banyak teks, dan jangan memakai penomoran langkah.',
    rendererStyle: 'story'
  },
  news: {
    id: 'news',
    label: 'Berita',
    icon: 'news',
    structureInstruction: 'TATA LETAK BERITA: Gunakan 4–5 slide informatif yang jelas dan tidak dramatis berlebihan. Slide pertama adalah HEADLINE utama yang mencerminkan peristiwa terpenting. Slide kedua memuat fakta utama / apa yang terjadi. Slide berikutnya memuat detail, konteks, atau data penting. Slide terakhir memuat perkembangan terakhir atau apa selanjutnya. Prioritaskan fakta, hindari opini yang tidak didukung sumber, dan jangan memakai penomoran langkah. Jika topik memakai sumber/referensi, seluruh isi faktual wajib tetap bersandar pada sistem sumber yang aktif.',
    rendererStyle: 'news'
  }
};

const LAYOUT_IDS = Object.keys(LAYOUTS);

function resolveContentLayout(value) {
  const id = String(value || '').trim().toLowerCase();
  return LAYOUTS[id] && id !== 'default' ? id : 'default';
}

function layoutInstruction(value) {
  const layout = LAYOUTS[resolveContentLayout(value)];
  return layout ? layout.structureInstruction : '';
}

function layoutRendererStyle(value) {
  const layout = LAYOUTS[resolveContentLayout(value)];
  return layout ? layout.rendererStyle : 'default';
}

module.exports = { LAYOUTS, LAYOUT_IDS, resolveContentLayout, layoutInstruction, layoutRendererStyle };
