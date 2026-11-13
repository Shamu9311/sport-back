// scripts/lib/embeddingImport.js — Validación y carga de embeddings de productos en vector(768).
import { readDump } from './mariadbDump.js';
import { EMBEDDING_DIMENSIONS, toPgVector } from '../../services/vectorUtils.js';

/**
 * Valida un embedding procedente del dump (JSON en texto).
 * @returns {{ ok: true, vector: number[] } | { ok: false, reason: string }}
 */
export function validateEmbedding(raw, dimensions = EMBEDDING_DIMENSIONS) {
  let vector = raw;
  if (typeof raw === 'string') {
    try {
      vector = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'JSON inválido' };
    }
  }
  if (!Array.isArray(vector)) return { ok: false, reason: 'no es un array' };
  if (vector.length !== dimensions) {
    return { ok: false, reason: `dimensión ${vector.length} ≠ ${dimensions}` };
  }
  if (!vector.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { ok: false, reason: 'valores no numéricos o no finitos' };
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return { ok: false, reason: 'vector nulo (norma 0)' };
  return { ok: true, vector };
}

export async function upsertProductEmbedding(client, productId, vector, model) {
  await client.query(
    `INSERT INTO product_embeddings (product_id, embedding, embedding_model)
     VALUES ($1, $2::vector, $3)
     ON CONFLICT (product_id) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model`,
    [productId, toPgVector(vector), model]
  );
}

/**
 * Migra los embeddings válidos del dump. No llama a Gemini.
 * @returns {Promise<{ migrated: number[], invalid: {product_id:number, reason:string}[], missing: number[] }>}
 */
export async function migrateEmbeddingsFromDump(client, { dumpPath, dump = readDump(dumpPath), log = console.log } = {}) {
  const rows = dump.product_embeddings?.rows || [];
  const { rows: products } = await client.query('SELECT product_id FROM products ORDER BY product_id');
  const productIds = new Set(products.map((p) => p.product_id));
  const result = { migrated: [], invalid: [], missing: [] };

  await client.query('BEGIN');
  try {
    for (const row of rows) {
      const productId = Number(row.product_id);
      if (!productIds.has(productId)) {
        result.invalid.push({ product_id: productId, reason: 'producto inexistente' });
        continue;
      }
      const check = validateEmbedding(row.embedding);
      if (!check.ok) {
        result.invalid.push({ product_id: productId, reason: check.reason });
        continue;
      }
      await upsertProductEmbedding(client, productId, check.vector, row.embedding_model || 'text-embedding-004');
      result.migrated.push(productId);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }

  const covered = new Set(result.migrated);
  result.missing = [...productIds].filter((id) => !covered.has(id));
  log(`  ✔ embeddings migrados: ${result.migrated.length}`);
  if (result.invalid.length) log(`  ⚠️ inválidos: ${JSON.stringify(result.invalid)}`);
  if (result.missing.length) log(`  ⚠️ productos sin embedding: ${result.missing.join(', ')}`);
  return result;
}
