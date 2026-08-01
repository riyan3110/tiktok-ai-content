const MEDIA_TYPES = new Set(['text', 'image', 'video']);
const ASSET_TYPES = new Set(['image', 'storyboard', 'reference-character', 'reference-product', 'audio', 'video']);

function normalizeAsset(asset, index) {
  if (!asset || !ASSET_TYPES.has(asset.type)) throw Object.assign(new Error(`Asset ${index + 1} has an invalid type`), { status: 422 });
  const source = asset.url || asset.data;
  if (!source) throw Object.assign(new Error(`Asset ${index + 1} requires url or data`), { status: 422 });
  return { id: asset.id || `asset-${index + 1}`, type: asset.type, name: asset.name || `${asset.type}-${index + 1}`, mimeType: asset.mimeType || 'application/octet-stream', url: asset.url || null, data: asset.data || null };
}

function buildGenerationRequest(input = {}, providerConfig = {}) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('Prompt is required'), { status: 422 });
  const mediaType = String(input.mediaType || input.type || 'text').toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) throw Object.assign(new Error('mediaType must be text, image, or video'), { status: 422 });
  const assets = (input.referenceAssets || input.assets || []).map(normalizeAsset);
  return {
    prompt, mediaType, assets, model: input.model || providerConfig.default_model,
    parameters: { aspectRatio: input.aspectRatio, duration: input.duration, resolution: input.resolution, style: input.style, seed: input.seed, negativePrompt: input.negativePrompt, ...input.parameters },
    metadata: { ...input.metadata, requestedAt: new Date().toISOString() }
  };
}

module.exports = { buildGenerationRequest, MEDIA_TYPES, ASSET_TYPES };
