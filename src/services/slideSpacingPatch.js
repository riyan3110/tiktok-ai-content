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
    if (selectedLayoutStyle === 'tutorial') {
      parts.push(\`<g data-layout="tutorial"><rect x="\${SAFE_AREA.left - 18}" y="\${CONTENT_TOP - 62}" width="\${SAFE_WIDTH + 36}" height="\${Math.max(250, layout.fit.height + 120)}" rx="30" fill="#f59e0b" fill-opacity=".08" stroke="#f59e0b" stroke-opacity=".55" stroke-width="3"/><line x1="\${SAFE_AREA.left}" y1="\${CONTENT_TOP - 34}" x2="\${WIDTH - SAFE_AREA.right}" y2="\${CONTENT_TOP - 34}" stroke="#f59e0b" stroke-width="6" stroke-linecap="round"/></g>\`);
    } else if (selectedLayoutStyle === 'story') {
      parts.push(\`<g data-layout="story"><line x1="\${SAFE_AREA.left - 24}" y1="\${CONTENT_TOP - 28}" x2="\${SAFE_AREA.left - 24}" y2="\${CONTENT_BOTTOM - 30}" stroke="#8b5cf6" stroke-opacity=".72" stroke-width="6" stroke-linecap="round"/><circle cx="\${SAFE_AREA.left - 24}" cy="\${CONTENT_TOP + 8}" r="12" fill="#8b5cf6"/><circle cx="\${SAFE_AREA.left - 24}" cy="\${Math.min(CONTENT_BOTTOM - 50, CONTENT_TOP + 220)}" r="8" fill="#8b5cf6" fill-opacity=".72"/></g>\`);
    } else if (selectedLayoutStyle === 'news') {
      parts.push(\`<g data-layout="news"><rect x="\${SAFE_AREA.left}" y="\${CONTENT_TOP - 64}" width="180" height="42" rx="8" fill="#dc2626"/><text x="\${SAFE_AREA.left + 16}" y="\${CONTENT_TOP - 35}" fill="#ffffff" font-family="Arial,sans-serif" font-size="22" font-weight="900" letter-spacing="1.2">BERITA</text><line x1="\${SAFE_AREA.left}" y1="\${CONTENT_TOP - 12}" x2="\${WIDTH - SAFE_AREA.right}" y2="\${CONTENT_TOP - 12}" stroke="#dc2626" stroke-width="7"/></g>\`);
    }

    if (layout.fit.bodyFit) {
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
      if (selectedLayoutStyle === 'tutorial') {
        parts.push(\`<line x1="\${SAFE_AREA.left}" y1="\${y - 26}" x2="\${WIDTH - SAFE_AREA.right}" y2="\${y - 26}" stroke="#f59e0b" stroke-opacity=".32" stroke-width="2"/>\`);
      } else if (selectedLayoutStyle === 'story') {
        parts.push(\`<circle cx="\${SAFE_AREA.left - 24}" cy="\${y - 10}" r="7" fill="#8b5cf6"/>\`);
      } else if (selectedLayoutStyle === 'news') {
        parts.push(\`<rect x="\${SAFE_AREA.left - 12}" y="\${y - 32}" width="7" height="\${Math.max(44, point.lines.length * layout.fit.pointSize * 1.22)}" rx="3" fill="#dc2626"/>\`);
      }
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
