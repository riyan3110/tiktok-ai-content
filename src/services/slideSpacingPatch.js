const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PATCHED = Symbol.for('aiads.slideSpacingPatch');

function install() {
  if (globalThis[PATCHED]) return;

  const filename = require.resolve('./images');
  if (require.cache[filename]) {
    throw new Error('Slide spacing patch harus dipasang sebelum images.js dimuat.');
  }

  let source = fs.readFileSync(filename, 'utf8');
  const original = `    if (layout.fit.bodyFit) {
      y += layout.fit.pointSpacing;
      parts.push(textElement(layout.fit.bodyFit.lines, { y, fontSize: layout.fit.bodyFit.fontSize, lineHeight: layout.fit.bodyFit.lineHeight, weight: 400, fill: '#f3e8ff' }));
      y += layout.fit.bodyFit.height;
    }
    for (const point of layout.content.points) {
      y += layout.fit.pointSpacing;
      parts.push(textElement(point.lines, { y, fontSize: layout.fit.pointSize, lineHeight: 1.22, weight: 600 }));
      y += point.lines.length * layout.fit.pointSize * 1.22;
    }`;

  const replacement = `    const selectedLayoutStyle = layout.layoutStyle || 'default';
    if (selectedLayoutStyle !== 'default') {
      // Non-default models own the whole composition. Remove the default
      // title/body that was already queued and render the selected template.
      parts.length = 0;
      parts.push(renderStructuredVariant(layout));
    } else {
      if (layout.fit.bodyFit) {
        // Default is intentionally preserved. Its existing visual behavior is
        // not changed by this patch.
        y += Math.max(36, layout.fit.pointSpacing + 18);
        parts.push(textElement(layout.fit.bodyFit.lines, { y, fontSize: layout.fit.bodyFit.fontSize, lineHeight: layout.fit.bodyFit.lineHeight, weight: 400, fill: '#f3e8ff' }));
        y += layout.fit.bodyFit.height;
      }
      let pointIndex = 0;
      for (const point of layout.content.points) {
        y += pointIndex === 0 && layout.fit.bodyFit
          ? Math.max(28, layout.fit.pointSpacing + 10)
          : layout.fit.pointSpacing;
        parts.push(textElement(point.lines, { y, fontSize: layout.fit.pointSize, lineHeight: 1.22, weight: 600 }));
        y += point.lines.length * layout.fit.pointSize * 1.22;
        pointIndex += 1;
      }
    }`;

  if (!source.includes(original)) {
    throw new Error('Target render spacing images.js tidak ditemukan; patch dibatalkan agar layout lain tidak berubah.');
  }

  source = source.replace(original, replacement);

  // Non-default title rules: cap the title wrap width so the REAL rendered
  // glyph run finishes before the red separator line (not past it / off-canvas).
  // measureTextWidth under-estimates Arial advances by up to ~12.5%, so a
  // safety of 1.0 let long titles render ~1015-1041px wide (past the 1010 line
  // and the 1080 canvas edge). 0.85 keeps the real line inside the red line
  // while still using most of the width (wide, 2-3 lines, never stacked/clipped).
  // Title height is also bounded so it always ends above the fixed image top.
  source = source.replace(
    'const CARD_TEXT_WIDTH_SAFETY = 0.88;',
    'const CARD_TEXT_WIDTH_SAFETY = 0.88;\nconst CARD_TITLE_TEXT_WIDTH_SAFETY = 0.85;\nconst INSERTED_IMAGE_TOP = 900;\nconst INSERTED_IMAGE_TITLE_MAX_HEIGHT = 174;'
  );
  source = source.replace(
    'function fitVariantText(text, maxWidth, maxHeight, startSize, minSize, maxLines, bold = false) {',
    'function fitVariantText(text, maxWidth, maxHeight, startSize, minSize, maxLines, bold = false, widthSafety = CARD_TEXT_WIDTH_SAFETY) {'
  );
  source = source.replace(
    'const safeWidth = Math.max(120, Math.floor(maxWidth * CARD_TEXT_WIDTH_SAFETY));',
    'const safeWidth = Math.max(120, Math.floor(maxWidth * widthSafety));'
  );

  const titleCalls = [
    'const titleFit = fitVariantText(titleText, titleTextWidth, 340, scale(isResultSlide ? 66 : 72), scale(40), isResultSlide ? 5 : 4, true);',
    'const titleFit = fitVariantText(titleText, titleTextWidth, 340, scale(isEndingSlide ? 66 : 72), scale(40), isEndingSlide ? 5 : 4, true);',
    'const titleFit = fitVariantText(titleText, newsTitleTextWidth, 330, scale(72), scale(42), 5, true);'
  ];
  const titleReplacements = [
    'const titleFit = fitVariantText(titleText, titleTextWidth, INSERTED_IMAGE_TITLE_MAX_HEIGHT, scale(isResultSlide ? 66 : 72), scale(40), 3, true, CARD_TITLE_TEXT_WIDTH_SAFETY);',
    'const titleFit = fitVariantText(titleText, titleTextWidth, INSERTED_IMAGE_TITLE_MAX_HEIGHT, scale(isEndingSlide ? 66 : 72), scale(40), 3, true, CARD_TITLE_TEXT_WIDTH_SAFETY);',
    'const titleFit = fitVariantText(titleText, newsTitleTextWidth, INSERTED_IMAGE_TITLE_MAX_HEIGHT, scale(72), scale(42), 3, true, CARD_TITLE_TEXT_WIDTH_SAFETY);'
  ];
  titleCalls.forEach((call, index) => {
    if (!source.includes(call)) throw new Error(`Target non-default title renderer ${index + 1} tidak ditemukan; patch dibatalkan.`);
    source = source.replace(call, titleReplacements[index]);
  });

  // Keep the image renderer's fixed Default geometry authoritative. The
  // inserted-image patch reads this marker through the exported constants and
  // therefore never needs to move the image down for a long title.
  if (!source.includes('const INSERTED_IMAGE_TOP = 900;')) {
    throw new Error('Kontrak posisi gambar Slide 1 tidak terpasang.');
  }

  const patchedModule = new Module(filename, module.parent);
  patchedModule.filename = filename;
  patchedModule.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = patchedModule;
  try {
    patchedModule._compile(source, filename);
  } catch (error) {
    delete require.cache[filename];
    throw error;
  }

  globalThis[PATCHED] = true;
}

module.exports = { install };
