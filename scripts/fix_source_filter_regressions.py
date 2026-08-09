from pathlib import Path

path = Path('src/services/sourceFilter.js')
text = path.read_text()

old = """function validateManualTopicIdentity(manualTopic, slides = []) {
  const anchors = topicEntityTokens(manualTopic);
  if (!anchors.length) return [];
  const specific = anchors.filter(anchor => !GENERIC_ENTITY_TOKENS.has(anchor));
  const required = specific.length ? specific : anchors;
  const carouselTokens = tokens(slides.map(slide => `${slide?.title || ''} ${slide?.body || ''} ${(slide?.points || []).join(' ')}`).join(' '));
  if (required.some(anchor => carouselTokens.has(anchor))) return [];
  return [`Isi carousel kehilangan objek utama topik manual: ${required.join(' / ')}.`];
}
"""
new = """function validateManualTopicIdentity(manualTopic, slides = []) {
  const anchors = topicEntityTokens(manualTopic);
  if (!anchors.length) return [];
  const required = anchors.filter(anchor => !GENERIC_ENTITY_TOKENS.has(anchor));
  if (!required.length) return [];
  const carouselTokens = tokens(slides.map(slide => `${slide?.title || ''} ${slide?.body || ''} ${(slide?.points || []).join(' ')}`).join(' '));
  if (required.some(anchor => carouselTokens.has(anchor))) return [];
  return [`Isi carousel kehilangan objek utama topik manual: ${required.join(' / ')}.`];
}
"""
assert old in text, 'validateManualTopicIdentity snippet changed unexpectedly'
text = text.replace(old, new, 1)

marker = "function semanticAuditPrompt(content, topic) {"
helper = r'''function dropUnsupportedPointClaims(content, semanticErrors = []) {
  if (!content || !Array.isArray(content.slides) || !Array.isArray(semanticErrors)) return null;
  const targets = semanticErrors.map(error => {
    const match = String(error || '').match(/SEMANTIC_SUPPORT:\s+slide:(\d+):point:(\d+)\b/);
    return match ? { slideIndex: Number(match[1]), pointIndex: Number(match[2]) } : null;
  }).filter(Boolean);
  if (!targets.length) return null;
  const slides = content.slides.map(slide => ({
    ...slide,
    points: Array.isArray(slide?.points) ? [...slide.points] : [],
    claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({ ...claim })) : []
  }));
  let changed = false;
  const grouped = new Map();
  for (const target of targets) {
    if (!grouped.has(target.slideIndex)) grouped.set(target.slideIndex, new Set());
    grouped.get(target.slideIndex).add(target.pointIndex);
  }
  for (const [slideIndex, pointIndexes] of grouped) {
    const slide = slides[slideIndex];
    if (!slide) continue;
    for (const pointIndex of [...pointIndexes].sort((a, b) => b - a)) {
      if (pointIndex < 0 || pointIndex >= slide.points.length) continue;
      const hasOtherContent = Boolean(String(slide.body || '').trim()) || slide.points.length > 1;
      if (!hasOtherContent) continue;
      slide.points.splice(pointIndex, 1);
      slide.claims = slide.claims.flatMap(claim => {
        const match = String(claim?.field || '').match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
        if (!match) return [claim];
        const claimPointIndex = Number(match[1]);
        if (claimPointIndex === pointIndex) return [];
        if (claimPointIndex > pointIndex) return [{ ...claim, field: `slide:${slideIndex}:point:${claimPointIndex - 1}` }];
        return [claim];
      });
      changed = true;
    }
  }
  return changed ? { ...content, slides } : null;
}

'''
assert marker in text, 'semanticAuditPrompt marker missing'
text = text.replace(marker, helper + marker, 1)

prompt_old = "- Jika error sebelumnya diawali SEMANTIC_SUPPORT, ganti claim dengan terjemahan/parafrase setia dari evidence yang benar-benar relevan; jangan mempertahankan klaim lama.\\n"
prompt_new = prompt_old + "- Jika SEMANTIC_SUPPORT mengenai sebuah point dan FACT_BANK tidak punya evidence yang benar-benar mendukung point itu, HAPUS point tersebut. Jangan mengarang point pengganti hanya untuk mempertahankan jumlah bullet.\\n"
assert prompt_old in text, 'semantic prompt rule missing'
text = text.replace(prompt_old, prompt_new, 1)

old_block = """    if (!checked.errors.length) {
      const semanticErrors = await auditClaimSemantics(openai, checked.content, topic);
      if (!semanticErrors.length) return checked.content;
      errors = semanticErrors;
      draft = { ...base, slides: checked.content.slides };
      continue;
    }
"""
new_block = """    if (!checked.errors.length) {
      const semanticErrors = await auditClaimSemantics(openai, checked.content, topic);
      if (!semanticErrors.length) return checked.content;
      const reduced = dropUnsupportedPointClaims(checked.content, semanticErrors);
      if (reduced) {
        const reducedChecked = validateVerifiedContent(base, { slides: reduced.slides }, {
          contentService: content,
          format: options.contentFormat,
          manualTopic: options.topicSource === 'manual' ? options.requestedTopic : '',
          sources
        });
        if (!reducedChecked.errors.length) {
          const remainingSemanticErrors = await auditClaimSemantics(openai, reducedChecked.content, topic);
          if (!remainingSemanticErrors.length) return reducedChecked.content;
          errors = remainingSemanticErrors;
          draft = { ...base, slides: reducedChecked.content.slides };
          continue;
        }
      }
      errors = semanticErrors;
      draft = { ...base, slides: checked.content.slides };
      continue;
    }
"""
assert old_block in text, 'semantic generation block changed unexpectedly'
text = text.replace(old_block, new_block, 1)

export_old = "  auditClaimSemantics,\n  MAX_VERIFY_ATTEMPTS"
export_new = "  auditClaimSemantics,\n  dropUnsupportedPointClaims,\n  MAX_VERIFY_ATTEMPTS"
assert export_old in text, 'module export marker missing'
text = text.replace(export_old, export_new, 1)
path.write_text(text)

test_path = Path('test/source-filter.test.js')
tests = test_path.read_text()
import_old = """  validateVerifiedContent,
  evidenceCandidates
"""
import_new = """  validateVerifiedContent,
  evidenceCandidates,
  validateManualTopicIdentity,
  dropUnsupportedPointClaims
"""
assert import_old in tests, 'source-filter test import marker missing'
tests = tests.replace(import_old, import_new, 1)
tests += r'''

test('AI API dan GPT tidak diperlakukan sebagai identitas unik yang wajib muncul literal', () => {
  const genericSlides = [
    { title: 'Hambatan saat membuat video', body: 'Proses produksi bisa memiliki beberapa kendala.', points: [] },
    { title: 'Kenali sumber masalah', body: 'Periksa bagian proses yang paling sering menghambat.', points: [] }
  ];
  assert.deepEqual(validateManualTopicIdentity('Menghadapi masalah saat membuat video AI', genericSlides), []);
  const namedErrors = validateManualTopicIdentity('Google Maps rilis fitur AI', genericSlides);
  assert.ok(namedErrors.some(error => /google \/ maps/i.test(error)));
});

test('point yang gagal semantic support dibuang dengan aman dan claim point berikutnya dinomori ulang', () => {
  const content = {
    slides: [{
      section: 'MASALAH',
      title: 'Hambatan produksi video',
      body: 'Ada beberapa sumber hambatan dalam proses produksi.',
      points: ['Waktu render terlalu lama', 'Berpindah tool membuang waktu'],
      claims: [
        { field: 'slide:0:point:0', text: 'Waktu render terlalu lama', sourceId: 'source-1', evidence: 'Switching between tools can waste a significant amount of time during production.' },
        { field: 'slide:0:point:1', text: 'Berpindah tool membuang waktu', sourceId: 'source-1', evidence: 'Switching between tools can waste a significant amount of time during production.' }
      ]
    }]
  };
  const reduced = dropUnsupportedPointClaims(content, [
    'SEMANTIC_SUPPORT: slide:0:point:0 tidak didukung evidence: evidence mentions time loss due to tool switching, not specifically long render time'
  ]);
  assert.ok(reduced);
  assert.deepEqual(reduced.slides[0].points, ['Berpindah tool membuang waktu']);
  assert.equal(reduced.slides[0].claims.length, 1);
  assert.equal(reduced.slides[0].claims[0].field, 'slide:0:point:0');
  assert.equal(content.slides[0].points.length, 2);
});
'''
test_path.write_text(tests)
