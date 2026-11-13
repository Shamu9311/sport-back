import pool from '../config/db.js';

import { EMBEDDING_DIMENSIONS, cosineSimilarity, toPgVector, fromPgVector } from './vectorUtils.js';

export { EMBEDDING_DIMENSIONS, cosineSimilarity, toPgVector, fromPgVector };

/**
 * Busca productos similares al perfil del usuario usando pgvector (distancia coseno `<=>`).
 * Similitud = 1 - distancia coseno.
 * @param {number[]} userEmbedding
 * @param {number} topK
 * @param {{ excludeProductIds?: number[], candidateProductIds?: number[] | null, withScores?: boolean }} options
 * @returns {Promise<number[]>} ids ordenados por similitud (o objetos con score si withScores=true)
 */
export async function findSimilarProducts(userEmbedding, topK = 20, options = {}) {
  const { excludeProductIds = [], candidateProductIds = null, withScores = false } = options;

  try {
    const queryVector = toPgVector(userEmbedding);
    const hasCandidates = Array.isArray(candidateProductIds) && candidateProductIds.length > 0;

    const { rows } = await pool.query(
      `
      SELECT pe.product_id,
             p.name,
             1 - (pe.embedding <=> $1::vector) AS similarity
      FROM product_embeddings pe
      JOIN products p ON pe.product_id = p.product_id
      WHERE p.is_active = TRUE
        AND ($2::int[] IS NULL OR pe.product_id = ANY($2::int[]))
        AND NOT (pe.product_id = ANY($3::int[]))
      ORDER BY pe.embedding <=> $1::vector, pe.product_id
      LIMIT $4
      `,
      [
        queryVector,
        hasCandidates ? candidateProductIds : null,
        excludeProductIds.map(Number),
        Math.max(parseInt(topK, 10) || 20, 1),
      ]
    );

    if (!rows || rows.length === 0) {
      console.warn('⚠️ No product embeddings found. Run scripts/generateProductEmbeddings.js first.');
      return [];
    }

    const scored = rows.map((row) => {
      const similarity = Number(row.similarity);
      return {
        product_id: row.product_id,
        name: row.name,
        similarity,
        score: similarity * 100,
      };
    });

    console.log(`🔍 Top 5 productos más similares (pgvector):`);
    scored.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} - Similitud: ${(p.similarity * 100).toFixed(2)}%`);
    });

    return withScores ? scored : scored.map((s) => s.product_id);
  } catch (error) {
    console.error('Error in findSimilarProducts:', error);
    throw error;
  }
}
