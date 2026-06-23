import pool from '../config/db.js';

// Calcular similitud coseno entre dos vectores
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    console.error('Invalid vectors for similarity calculation');
    return 0;
  }
  
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Buscar productos similares al perfil del usuario.
 * @param {number[]} userEmbedding
 * @param {number} topK
 * @param {{ excludeProductIds?: number[], candidateProductIds?: number[] }} options
 */
export async function findSimilarProducts(userEmbedding, topK = 20, options = {}) {
  const { excludeProductIds = [], candidateProductIds = null } = options;

  try {
    let query = `
      SELECT pe.product_id, pe.embedding, p.name
      FROM product_embeddings pe
      JOIN products p ON pe.product_id = p.product_id
      WHERE pe.embedding IS NOT NULL AND p.is_active = 1
    `;
    const params = [];

    if (candidateProductIds && candidateProductIds.length > 0) {
      const placeholders = candidateProductIds.map(() => '?').join(',');
      query += ` AND pe.product_id IN (${placeholders})`;
      params.push(...candidateProductIds);
    }

    if (excludeProductIds.length > 0) {
      const placeholders = excludeProductIds.map(() => '?').join(',');
      query += ` AND pe.product_id NOT IN (${placeholders})`;
      params.push(...excludeProductIds);
    }

    const [products] = await pool.query(query, params);
    
    if (!products || products.length === 0) {
      console.warn('⚠️ No product embeddings found. Run generateProductEmbeddings.js first.');
      return [];
    }
    
    // Calcular similitud para cada producto
    const scored = products.map(product => {
      try {
        const productEmbedding = JSON.parse(product.embedding);
        const similarity = cosineSimilarity(userEmbedding, productEmbedding);
        
        return {
          product_id: product.product_id,
          name: product.name,
          similarity: similarity,
          score: similarity * 100
        };
      } catch (error) {
        console.error(`Error parsing embedding for product ${product.product_id}:`, error);
        return null;
      }
    }).filter(item => item !== null);
    
    // Ordenar por similitud descendente
    scored.sort((a, b) => b.similarity - a.similarity);
    
    console.log(`🔍 Top 5 productos más similares:`);
    scored.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} - Similitud: ${(p.similarity * 100).toFixed(2)}%`);
    });
    
    // Devolver solo los IDs de los top K
    return scored.slice(0, topK).map(s => s.product_id);
    
  } catch (error) {
    console.error('Error in findSimilarProducts:', error);
    throw error;
  }
}
