// scripts/lib/ingredientStore.js — Persistencia (idempotente) de catálogos e ingredientes normalizados.
import { loadCatalogs, normalizeProducts } from './ingredientNormalizer.js';

const NORMALIZER_SOURCES = ['nutrition_column', 'other_components', 'product_description'];

/** Lee productos y filas de nutrición (solo lectura). */
export async function loadProductsForNormalization(client) {
  const { rows } = await client.query(`
    SELECT p.product_id, p.name, p.type_id, pt.name AS type_name, p.description,
           COALESCE(json_agg(json_build_object(
             'nutrition_id', pn.nutrition_id, 'serving_size', pn.serving_size,
             'carbs_g', pn.carbs_g, 'protein_g', pn.protein_g, 'sodium_mg', pn.sodium_mg,
             'potassium_mg', pn.potassium_mg, 'magnesium_mg', pn.magnesium_mg,
             'caffeine_mg', pn.caffeine_mg, 'other_components', pn.other_components
           ) ORDER BY pn.nutrition_id) FILTER (WHERE pn.nutrition_id IS NOT NULL), '[]') AS nutrition
    FROM products p
    LEFT JOIN product_types pt ON pt.type_id = p.type_id
    LEFT JOIN product_nutrition pn ON pn.product_id = p.product_id
    GROUP BY p.product_id, pt.name
    ORDER BY p.product_id`);
  return rows;
}

export async function computeNormalization(client, catalogs = loadCatalogs()) {
  const products = await loadProductsForNormalization(client);
  return { catalogs, products, ...normalizeProducts(products, catalogs) };
}

/** Upsert de catálogos (ingredientes y formulaciones). */
export async function upsertCatalogs(client, catalogs) {
  const counts = { ingredients: 0, formulations: 0 };
  for (const ing of catalogs.ingredients) {
    const { rowCount } = await client.query(
      `INSERT INTO ingredients (code, display_name, aliases, description, category, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases,
         description = EXCLUDED.description, category = EXCLUDED.category, is_active = EXCLUDED.is_active
       WHERE (ingredients.display_name, ingredients.aliases, ingredients.description, ingredients.category, ingredients.is_active)
             IS DISTINCT FROM (EXCLUDED.display_name, EXCLUDED.aliases, EXCLUDED.description, EXCLUDED.category, EXCLUDED.is_active)`,
      [ing.code, ing.display_name, ing.aliases || [], ing.description || null, ing.category, ing.is_active ?? true]
    );
    counts.ingredients += rowCount;
  }
  for (const f of catalogs.formulations) {
    const { rows } = await client.query(
      `INSERT INTO formulations (code, display_name, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description
       RETURNING formulation_id`,
      [f.code, f.display_name, f.description || null]
    );
    for (const fi of f.ingredients) {
      await client.query(
        `INSERT INTO formulation_ingredients (formulation_id, ingredient_id, ratio_part)
         SELECT $1, ingredient_id, $3 FROM ingredients WHERE code = $2
         ON CONFLICT (formulation_id, ingredient_id) DO UPDATE SET ratio_part = EXCLUDED.ratio_part`,
        [rows[0].formulation_id, fi.ingredient, fi.ratio_part]
      );
    }
    counts.formulations += 1;
  }
  return counts;
}

/**
 * Aplica la normalización. Idempotente:
 *  - inserta/actualiza filas auto_confident de las fuentes del normalizador;
 *  - NO toca filas revisadas manualmente ni las que vienen de una especificación del fabricante;
 *  - elimina filas automáticas que ya no se derivan de los datos;
 *  - registra ambiguos en ingredient_mapping_review sin reabrir los ya resueltos.
 */
export async function applyNormalization(client, normalization) {
  const counts = { inserted: 0, updated: 0, unchanged: 0, deleted: 0, formulations: 0, reviews_new: 0 };
  await upsertCatalogs(client, normalization.catalogs);

  const keep = new Set();
  for (const it of normalization.productIngredients) {
    const { rows } = await client.query(
      `INSERT INTO product_ingredients
         (product_id, ingredient_id, amount, unit, basis, serving_description, form, notes, data_source, review_status)
       SELECT $1, ingredient_id, $3, $4, $5, $6, $7, $8, $9, 'auto_confident' FROM ingredients WHERE code = $2
       ON CONFLICT (product_id, ingredient_id, basis) DO UPDATE SET
         amount = EXCLUDED.amount, unit = EXCLUDED.unit, serving_description = EXCLUDED.serving_description,
         form = EXCLUDED.form, notes = EXCLUDED.notes, data_source = EXCLUDED.data_source
       WHERE product_ingredients.review_status = 'auto_confident'
         AND product_ingredients.data_source = ANY($10::text[])
         AND (product_ingredients.amount, product_ingredients.unit, product_ingredients.serving_description,
              product_ingredients.form, product_ingredients.notes, product_ingredients.data_source)
             IS DISTINCT FROM (EXCLUDED.amount, EXCLUDED.unit, EXCLUDED.serving_description,
              EXCLUDED.form, EXCLUDED.notes, EXCLUDED.data_source)
       RETURNING (xmax = 0) AS inserted, ingredient_id`,
      [it.product_id, it.ingredient_code, it.amount, it.unit, it.basis, it.serving_description, it.form, it.notes,
       it.data_source, NORMALIZER_SOURCES]
    );
    if (rows.length === 0) counts.unchanged += 1;
    else if (rows[0].inserted) counts.inserted += 1;
    else counts.updated += 1;
    keep.add(`${it.product_id}|${it.ingredient_code}|${it.basis}`);
  }

  // Limpieza de filas automáticas que ya no se derivan (datos del catálogo corregidos)
  const { rows: autoRows } = await client.query(
    `SELECT pi.product_id, i.code, pi.basis FROM product_ingredients pi JOIN ingredients i USING (ingredient_id)
     WHERE pi.review_status = 'auto_confident' AND pi.data_source = ANY($1::text[])`,
    [NORMALIZER_SOURCES]
  );
  for (const r of autoRows) {
    if (!keep.has(`${r.product_id}|${r.code}|${r.basis}`)) {
      await client.query(
        `DELETE FROM product_ingredients pi USING ingredients i
         WHERE pi.ingredient_id = i.ingredient_id AND pi.product_id = $1 AND i.code = $2 AND pi.basis = $3`,
        [r.product_id, r.code, r.basis]
      );
      counts.deleted += 1;
    }
  }

  for (const pf of normalization.productFormulations) {
    const { rowCount } = await client.query(
      `INSERT INTO product_formulations (product_id, formulation_id, data_source)
       SELECT $1, formulation_id, $3 FROM formulations WHERE code = $2
       ON CONFLICT (product_id, formulation_id) DO NOTHING`,
      [pf.product_id, pf.formulation_code, pf.data_source]
    );
    counts.formulations += rowCount;
  }

  for (const r of normalization.reviews) {
    const { rowCount } = await client.query(
      `INSERT INTO ingredient_mapping_review (product_id, origin, raw_text, suggested_code, reason)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (product_id, origin, raw_text) DO NOTHING`,
      [r.product_id, r.origin, r.raw_text, r.suggested_code || null, r.reason]
    );
    counts.reviews_new += rowCount;
  }
  return counts;
}
