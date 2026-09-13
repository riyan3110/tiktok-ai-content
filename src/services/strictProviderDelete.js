'use strict';

function install({ app, db, dynamicAi }) {
  if (!app || !db || !dynamicAi) throw new Error('strictProviderDelete requires app, db, and dynamicAi');

  app.delete('/api/dynamic-ai/providers/:id', (req, res, next) => {
    try {
      dynamicAi.ensureSchema(db);
      const id = String(req.params.id || '').trim();
      const before = db.prepare(`
        SELECT selected_provider_id, selected_text_provider_id, selected_image_provider_id,
               text_fallback_enabled, image_fallback_enabled
        FROM ai_dynamic_provider_state WHERE id=1
      `).get();

      const wasSelectedText = before?.selected_text_provider_id === id;
      const wasSelectedImage = before?.selected_image_provider_id === id;
      const textFallback = Number(Boolean(before?.text_fallback_enabled));
      const imageFallback = Number(Boolean(before?.image_fallback_enabled));

      // Reuse the existing root-clean delete path so credentials, cached models,
      // legacy references and active requests are removed exactly as before.
      dynamicAi.removeProvider(db, id);

      // removeProvider historically picked another saved provider automatically.
      // That is forbidden here: deleting an active provider must leave the role
      // unselected until the user explicitly picks/saves a provider again.
      db.transaction(() => {
        if (wasSelectedText) {
          db.prepare(`
            UPDATE ai_dynamic_provider_state
            SET selected_provider_id=NULL,
                selected_text_provider_id=NULL,
                text_fallback_enabled=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=1
          `).run(textFallback);
        }
        if (wasSelectedImage) {
          db.prepare(`
            UPDATE ai_dynamic_provider_state
            SET selected_image_provider_id=NULL,
                image_fallback_enabled=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=1
          `).run(imageFallback);
        }
      })();

      res.json(dynamicAi.publicState(db));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { install };
