// scripts/lib/evidenceEmbeddings.js — Embeddings de evidence_chunks (gemini-embedding-001, 768, RETRIEVAL_DOCUMENT).
// Idempotente: solo procesa chunks sin vector, con contenido cambiado o con vector de otro modelo.
import { generateEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, TASK_TYPES } from '../../services/embeddingServices.js';
import { toPgVector } from '../../services/vectorUtils.js';

export function assertValidEmbedding(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding con dimensión ${values?.length}; se esperaban ${EMBEDDING_DIMENSIONS}.`);
  }
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding nulo (norma 0) o no finito.');
  return toPgVector(values);
}

export async function findPendingChunks(client, { sourceIds = null, model = EMBEDDING_MODEL } = {}) {
  const { rows } = await client.query(
    `SELECT ch.chunk_id, ch.content, ch.content_hash, s.source_key
     FROM evidence_chunks ch JOIN evidence_sources s ON s.source_id = ch.source_id
     WHERE s.review_status <> 'retired'
       AND ($1::int[] IS NULL OR ch.source_id = ANY($1::int[]))
       AND (ch.embedding IS NULL
            OR ch.embedded_content_hash IS DISTINCT FROM ch.content_hash
            OR ch.embedding_model IS DISTINCT FROM $2)
     ORDER BY ch.source_id, ch.chunk_index`,
    [sourceIds && sourceIds.length ? sourceIds : null, model]
  );
  return rows;
}

/**
 * Genera y guarda embeddings pendientes. Cada chunk se guarda por separado: un fallo no afecta a los demás.
 * @returns {Promise<{ pending: number, embedded: number, failed: {chunk_id:number, error:string}[] }>}
 */
export async function embedPendingChunks(client, { sourceIds = null, delayMs = 0, log = () => {} } = {}) {
  const pending = await findPendingChunks(client, { sourceIds });
  const summary = { pending: pending.length, embedded: 0, failed: [] };
  for (const [i, chunk] of pending.entries()) {
    try {
      const vector = assertValidEmbedding(await generateEmbedding(chunk.content, { taskType: TASK_TYPES.document }));
      await client.query(
        `UPDATE evidence_chunks SET embedding = $2::vector, embedding_model = $3,
                embedded_content_hash = $4, embedded_at = now()
         WHERE chunk_id = $1 AND content_hash = $4`,
        [chunk.chunk_id, vector, EMBEDDING_MODEL, chunk.content_hash]
      );
      summary.embedded += 1;
      log(`  ✅ [${i + 1}/${pending.length}] ${chunk.source_key}#${chunk.chunk_id}`);
    } catch (error) {
      summary.failed.push({ chunk_id: chunk.chunk_id, error: error.message });
      log(`  ❌ [${i + 1}/${pending.length}] ${chunk.source_key}#${chunk.chunk_id}: ${error.message}`);
    }
    if (delayMs > 0 && i < pending.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return summary;
}
