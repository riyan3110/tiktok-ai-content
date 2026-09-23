const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const addon = fs.readFileSync(path.join(__dirname, '../public/legacy-carousel-addon.js'), 'utf8');
const insertion = fs.readFileSync(path.join(__dirname, '../src/services/insertedImagePatch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const imagesSource = fs.readFileSync(path.join(__dirname, '../src/services/images.js'), 'utf8');

test('legacy carousel selector is repurposed as one optional inserted image, not an AI reference', () => {
  assert.match(addon, /heading\.textContent = 'Sisipkan gambar'/);
  assert.match(addon, /selectButton\.textContent = '□ Pilih gambar'/);
  assert.match(addon, /Belum ada gambar disisipkan/);
  assert.match(addon, /multiple:\s*false/);
  assert.match(addon, /delete body\.assetIds/);
  assert.match(addon, /\/contents\/\$\{encodeURIComponent\(generated\.id\)\}\/insert-image/);
});

test('gambar slide-1 besar, margin rapi, tanpa frame/border, dan aman terhadap judul panjang', () => {
  assert.match(insertion, /const MARGIN = 54/);
  assert.match(insertion, /const BASE_INSERT_TOP = 900/);
  assert.match(insertion, /const TITLE_GAP = 56/);
  assert.match(insertion, /function titleFitForInsert\(images, renderSource\)/);
  assert.match(insertion, /function resolveInsertBox\(images, renderSource = \{\}\)/);
  assert.match(insertion, /fit: 'contain'/);
  assert.match(insertion, /position: 'centre'/);
  assert.doesNotMatch(insertion, /fit: 'cover'/);
  assert.match(insertion, /blend: 'dest-in'/);
  assert.doesNotMatch(insertion, /stroke="#ffffff"/);
  assert.doesNotMatch(insertion, /fill-opacity="0\.28"/);
  assert.doesNotMatch(insertion, /INSERT_PAD/);
  assert.match(insertion, /await overlaySlideOne\(files\[0\], file\.data, resolveInsertBox\(images, renderSource\)\)/);
  assert.match(insertion, /await overlaySlideOne\(slides\[0\], file\.data, resolveInsertBox\(images, renderSource\)\)/);
  assert.doesNotMatch(insertion, /overlaySlideOne\(files\[i\]/);
  assert.match(insertion, /renderSource\.insertedImageAssetId = assetId/);
});

test('compact TikTok copy is derived from real TikTok statuses', () => {
  assert.match(addon, /PROCESSING_DOWNLOAD: 'TikTok sedang memproses draft…'/);
  assert.match(addon, /SEND_TO_USER_INBOX: 'Draft sudah masuk ke TikTok ✅'/);
  assert.match(addon, /if \(status === 'FAILED'\)/);
  assert.match(addon, /statusNode\.dataset\.tiktokStatus = String\(data\?\.status \|\| ''\)/);
  assert.match(addon, /statusNode\.title = technicalStatus\(data\)/);
});

test('Content Studio shortcuts move to the top and the long text helper is hidden', () => {
  assert.match(addon, /PRIORITY_NAV_HREFS = Object\.freeze\(\[\s*'#studio',\s*'#trend-reference',\s*'#schedule-dashboard',\s*'#history-section'/s);
  assert.match(addon, /document\.querySelector\('#text-generate-field > small'\)/);
  assert.match(addon, /textHelper\.hidden = true/);
  assert.match(addon, /priorityLinks\.forEach\(link => fragment\.append\(link\)\)/);
  assert.match(addon, /nav\.prepend\(fragment\)/);
  assert.match(addon, /nav\.dataset\.priorityItemsMoved = 'true'/);
});

test('carousel can be prepared as multiple image files for the Android share sheet', () => {
  assert.match(addon, /shareButton\.id = 'share-carousel'/);
  assert.match(addon, /shareButton\.textContent = 'Bagikan \+ salin caption'/);
  assert.match(addon, /slidesHost\.querySelectorAll\('img'\)/);
  assert.match(addon, /new File\(\[blob\], `ai-ads-lab-slide-\$\{index \+ 1\}\.\$\{extension\}`/);
  assert.match(addon, /navigator\.canShare\(\{ files \}\)/);
  assert.match(addon, /await navigator\.share\(\{/);
  assert.match(addon, /text: shareText/);
  assert.match(addon, /files: preparedFiles/);
  assert.match(addon, /MutationObserver\(\(\) => \{ void prepareShareFiles\(\); \}\)/);
  assert.match(addon, /installNativeShareUi\(\)/);
});

test('native share copies caption and generated hashtags together before handing off files', () => {
  assert.match(addon, /let latestHashtags = \[\]/);
  assert.match(addon, /function normalizeHashtag\(value\)/);
  assert.match(addon, /function buildShareText\(\)/);
  assert.match(addon, /latestHashtags = Array\.isArray\(item\?\.hashtags\) \? item\.hashtags : \[\]/);
  assert.match(addon, /return \[caption, hashtags\.join\(' '\)\]\.filter\(Boolean\)\.join\('\\n\\n'\)/);
  assert.match(addon, /function copyCaptionToClipboard\(text\)/);
  assert.match(addon, /navigator\.clipboard\?\.writeText/);
  assert.match(addon, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(addon, /document\.execCommand\('copy'\)/);
  assert.match(addon, /const shareText = buildShareText\(\)/);
  assert.match(addon, /const clipboardResult = copyCaptionToClipboard\(shareText\)/);
  assert.match(addon, /Caption \+ tagar sudah disalin/);
});

test('server mounts post-render insertion without replacing the existing generator', () => {
  assert.match(server, /installInsertedImagePatch\(\{ app, db, images \}\)/);
  assert.doesNotMatch(server, /generateAndSave\s*=/);
});

test('insert image UI provides two source options (Assets library & Device upload) with preview, Ganti, and Hapus', () => {
  assert.match(addon, /Pilih dari Asset/);
  assert.match(addon, /Unggah dari perangkat/);
  assert.match(addon, /accept = 'image\/\*'/);
  assert.match(addon, /\/api\/assets\/upload/);
  assert.match(addon, /Ganti/);
  assert.match(addon, /Hapus/);
  assert.match(addon, /inserted-image-preview/);
});

test('inserted image source dialog has responsive mobile margin and containment', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  assert.match(css, /#inserted-image-source-dialog\{width:min\(440px,calc\(100vw - 36px\)\)/);
  assert.match(css, /#inserted-image-source-dialog\{width:calc\(100vw - 36px\);max-width:calc\(100vw - 36px\);margin:auto;padding:18px 16px/);
});

test('Kategori Konten and Format Konten visibility rules in app.js', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(indexHtml, /id="category-format-grid"/);
  assert.match(appJs, /syncCategoryFormatVisibility/);
  assert.match(appJs, /const shouldHide = topicSource === 'manual' && isWithoutUrl/);
});

test('judul Tutorial/Cerita/Berita memakai lebar penuh garis pemisah (bukan dipersempit)', () => {
  assert.match(imagesSource, /const titleTextWidth = cardWidth;/);
  const tutorialBlock = imagesSource.split("if (style === 'tutorial')")[1].split("if (style === 'story')")[0];
  const storyBlock = imagesSource.split("if (style === 'story')")[1].split("// style === 'news'")[0];
  const newsBlock = imagesSource.split("// style === 'news'")[1].split('let result = compose')[0];
  assert.match(tutorialBlock, /const titleTextWidth = cardWidth;/);
  assert.match(storyBlock, /const titleTextWidth = cardWidth;/);
  assert.match(newsBlock, /const newsTitleTextWidth = newsWidth;/);
  assert.doesNotMatch(tutorialBlock, /titleTextWidth = (?:isResultSlide \? cardWidth - \d+ : )?cardWidth - \d+/);
  assert.doesNotMatch(storyBlock, /titleTextWidth = (?:isEndingSlide \? cardWidth - \d+ : )?cardWidth - \d+/);
  assert.doesNotMatch(newsBlock, /newsTitleTextWidth = newsWidth - \d+/);
});
