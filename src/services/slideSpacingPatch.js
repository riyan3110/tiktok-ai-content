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

  const replacement = `    if (layout.fit.bodyFit) {
      // Keep the title anchored in its existing position, but give the body a
      // little more breathing room so title and paragraph do not look stacked.
      y += Math.max(36, layout.fit.pointSpacing + 18);
      parts.push(textElement(layout.fit.bodyFit.lines, { y, fontSize: layout.fit.bodyFit.fontSize, lineHeight: layout.fit.bodyFit.lineHeight, weight: 400, fill: '#f3e8ff' }));
      y += layout.fit.bodyFit.height;
    }
    let pointIndex = 0;
    for (const point of layout.content.points) {
      // Add a distinct gap before the bullet group. Spacing between bullets
      // themselves stays unchanged so the list still reads as one group.
      y += pointIndex === 0 && layout.fit.bodyFit
        ? Math.max(28, layout.fit.pointSpacing + 10)
        : layout.fit.pointSpacing;
      parts.push(textElement(point.lines, { y, fontSize: layout.fit.pointSize, lineHeight: 1.22, weight: 600 }));
      y += point.lines.length * layout.fit.pointSize * 1.22;
      pointIndex += 1;
    }`;

  if (!source.includes(original)) {
    throw new Error('Target render spacing images.js tidak ditemukan; patch dibatalkan agar layout lain tidak berubah.');
  }

  source = source.replace(original, replacement);

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
