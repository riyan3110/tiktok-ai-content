const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const images = require('../src/services/images');
const { resolveInsertBox, titleFitForInsert } = require('../src/services/insertedImagePatch');

const titleCases = [
  ['tutorial', 'Hubungkan Server ke GitLab Menggunakan SSH Tanpa Password Berulang'],
  ['story', 'Kalau hasilnya gagal, apa yang sebenarnya masih kita punya?'],
  ['news', 'Belum Ada Kabar Terverifikasi tentang Kapal Virgo']
];

test('non-default Slide 1 title uses full width and fits above the fixed Default image', () => {
  for (const [layout, title] of titleCases) {
    const fit = titleFitForInsert(images, { contentLayout: layout, slides: [{ title }] });
    assert.ok(fit, `${layout} title should fit`);
    assert.ok(fit.lines.length <= 3, `${layout} title wrapped into ${fit.lines.length} lines`);
    assert.ok(fit.height <= 174, `${layout} title height ${fit.height} exceeds image-safe area`);

    const box = resolveInsertBox(images, { contentLayout: layout, slides: [{ title }] });
    assert.deepEqual(box, { left: 54, top: 900, width: 972, height: 966 });
  }
});

test('runtime renderer keeps Default untouched while non-default titles are widened and constrained', () => {
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = {
      section: 'HEADLINE',
      title: 'Belum Ada Kabar Terverifikasi tentang Kapal Virgo',
      body: 'Isi singkat untuk memeriksa komposisi.',
      points: ['Fakta pertama yang relevan']
    };
    for (const style of ['default', 'tutorial', 'story', 'news']) {
      const layout = images.buildStructuredLayout(slide, 0, 4, 'Fakta singkat', {
        textInputOnly: true,
        layoutStyle: style
      });
      process.stdout.write(`STYLE:${style}\\n`);
      process.stdout.write(images.renderLayout(layout, 1, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
      process.stdout.write('\\nEND\\n');
    }
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  const defaultSvg = output.split('STYLE:default\n')[1].split('\nEND')[0];
  assert.doesNotMatch(defaultSvg, /data-layout="tutorial"|data-layout="story"|data-layout="news"/);

  for (const style of ['tutorial', 'story', 'news']) {
    const svg = output.split(`STYLE:${style}\n`)[1].split('\nEND')[0];
    assert.match(svg, new RegExp(`data-layout="${style}"`));
    assert.match(svg, /width="920"/);
    const titleLines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
    assert.ok(titleLines.length >= 1 && titleLines.length <= 3, `${style} title rendered in ${titleLines.length} lines`);
  }
});
