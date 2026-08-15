const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const addon = fs.readFileSync(path.join(__dirname, '../public/legacy-carousel-addon.js'), 'utf8');
const insertion = fs.readFileSync(path.join(__dirname, '../src/services/insertedImagePatch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');

test('legacy carousel selector is repurposed as one optional inserted image, not an AI reference', () => {
  assert.match(addon, /heading\.textContent = 'Sisipkan gambar'/);
  assert.match(addon, /selectButton\.textContent = '□ Pilih gambar'/);
  assert.match(addon, /Belum ada gambar disisipkan/);
  assert.match(addon, /multiple:\s*false/);
  assert.match(addon, /delete body\.assetIds/);
  assert.match(addon, /\/contents\/\$\{encodeURIComponent\(generated\.id\)\}\/insert-image/);
});

test('selected image fills a large framed area on slide one below the hook', () => {
  assert.match(insertion, /INSERT_BOX = Object\.freeze\(\{ left: 50, top: 900, width: 980, height: 920 \}\)/);
  assert.match(insertion, /fit: 'cover'/);
  assert.match(insertion, /position: 'centre'/);
  assert.match(insertion, /await overlaySlideOne\(files\[0\], file\.data\)/);
  assert.match(insertion, /await overlaySlideOne\(slides\[0\], file\.data\)/);
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
  assert.match(addon, /shareButton\.textContent = 'Bagikan ke aplikasi'/);
  assert.match(addon, /slidesHost\.querySelectorAll\('img'\)/);
  assert.match(addon, /new File\(\[blob\], `ai-ads-lab-slide-\$\{index \+ 1\}\.\$\{extension\}`/);
  assert.match(addon, /navigator\.canShare\(\{ files \}\)/);
  assert.match(addon, /await navigator\.share\(\{/);
  assert.match(addon, /text: captionInput\.value\.trim\(\)/);
  assert.match(addon, /files: preparedFiles/);
  assert.match(addon, /MutationObserver\(\(\) => \{ void prepareShareFiles\(\); \}\)/);
  assert.match(addon, /installNativeShareUi\(\)/);
});

test('server mounts post-render insertion without replacing the existing generator', () => {
  assert.match(server, /installInsertedImagePatch\(\{ app, db, images \}\)/);
  assert.doesNotMatch(server, /generateAndSave\s*=/);
});
