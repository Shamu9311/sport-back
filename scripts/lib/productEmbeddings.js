// scripts/lib/productEmbeddings.js — Genera embeddings de productos con Gemini y los guarda en vector(768).
import { generateProductEmbedding, EMBEDDING_MODEL } from '../../services/embeddingServices.js';
import { upsertProductEmbedding } from './embeddingImport.js';

export const EMBEDDING_MODEL_NAME = EMBEDDING_MODEL;

/**
 * Texto-fuente de cada producto (agregaciones compatibles con PostgreSQL).
 * onlyMissing: productos sin embedding o con embedding de OTRO modelo (p. ej. text-embedding-004 retirado),
 * porque vectores de modelos distintos no son comparables entre sí.
 */
export async function loadProductsForEmbedding(client, { productIds = null, onlyMissing = false } = {}) {
  const { rows } = await client.query(
    `
    SELECT p.product_id,
           p.name,
           p.description,
           p.usage_recommendation,
           pt.name AS type_name,
           pc.name AS category_name,
           pc.usage_context,
           MAX(pn.other_components) AS other_components,
           MAX(pn.protein_g)   AS protein_g,
           MAX(pn.carbs_g)     AS carbs_g,
           MAX(pn.energy_kcal) AS energy_kcal,
           MAX(pn.caffeine_mg) AS caffeine_mg,
           string_agg(DISTINCT pa.name, ',') AS attributes
    FROM products p
    LEFT JOIN product_types pt ON p.type_id = pt.type_id
    LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
    LEFT JOIN product_nutrition pn ON p.product_id = pn.product_id
    LEFT JOIN product_attributes_mapping pam ON p.product_id = pam.product_id
    LEFT JOIN product_attributes pa ON pam.attribute_id = pa.attribute_id
    WHERE p.is_active = TRUE
      AND ($1::int[] IS NULL OR p.product_id = ANY($1::int[]))
      AND (NOT $2::boolean OR NOT EXISTS (
            SELECT 1 FROM product_embeddings pe
            WHERE pe.product_id = p.product_id AND pe.embedding_model = $3))
    GROUP BY p.product_id, pt.name, pc.name, pc.usage_context
    ORDER BY p.product_id
    `,
    [productIds && productIds.length ? productIds : null, onlyMissing, EMBEDDING_MODEL_NAME]
  );
  return rows;
}

/**
 * Genera y guarda embeddings con Gemini. delayMs evita superar el rate limit de la API.
 * @returns {Promise<{ ok: number, failed: {product_id:number, error:string}[] }>}
 */
export async function regenerateEmbeddings(
  client,
  { productIds = null, onlyMissing = false, delayMs = 500, log = console.log } = {}
) {
  const products = await loadProductsForEmbedding(client, { productIds, onlyMissing });
  const summary = { ok: 0, failed: [] };
  log(`🚀 Generando embeddings para ${products.length} productos (modelo ${EMBEDDING_MODEL_NAME})...`);

  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    try {
      const embedding = await generateProductEmbedding(product);
      await upsertProductEmbedding(client, product.product_id, embedding, EMBEDDING_MODEL_NAME);
      summary.ok += 1;
      log(`  ✅ [${i + 1}/${products.length}] ${product.name}`);
    } catch (error) {
      summary.failed.push({ product_id: product.product_id, error: error.message });
      log(`  ❌ [${i + 1}/${products.length}] ${product.name}: ${error.message}`);
    }
    if (delayMs > 0 && i < products.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return summary;
}
