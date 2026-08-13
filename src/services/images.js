const base = require('./imagesBase');

const ZERO_WIDTH = '\u200B';
const TITLE_ONLY_SPACER = ZERO_WIDTH.repeat(70);

function prepareTextInputContent(content) {
  if (content?.verificationStatus !== 'text_input_only' || !Array.isArray(content.slides)) return content;
  const slides = content.slides.map((slide, index) => {
    const points = Array.isArray(slide.points)
      ? slide.points.map(point => {
        const value = String(point || '').trim();
        return /^\d+\s+/.test(value) ? `${ZERO_WIDTH}${value}` : value;
      })
      : [];
    const titleOnlyHook = index === 0 && slide.title && !String(slide.body || '').trim() && !points.length;
    return { ...slide, body: titleOnlyHook ? TITLE_ONLY_SPACER : slide.body, points };
  });
  return { ...content, contentFormat: 'Generate dari Teks', slides };
}

async function createSlides(id, content) {
  return base.createSlides(id, prepareTextInputContent(content));
}

function buildSlideLayouts(content) {
  return base.buildSlideLayouts(prepareTextInputContent(content));
}

module.exports = { ...base, createSlides, buildSlideLayouts, prepareTextInputContent };
