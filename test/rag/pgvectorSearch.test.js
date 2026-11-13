import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../config/db.js';
import { findSimilarProducts, fromPgVector, toPgVector } from '../../services/vectorSearchService.js';
import { cosineSimilarity } from '../../services/vectorUtils.js';

async function productVector(productId) {
  const { rows } = await pool.query(
    'SELECT embedding::text AS embedding FROM product_embeddings WHERE product_id = $1',
    [productId]
  );
  return fromPgVector(rows[0].embedding);
}

describe('Búsqueda vectorial en PostgreSQL (pgvector, distancia coseno <=>)', () => {
  afterAll(async () => {
    await pool.query('UPDATE products SET is_active = TRUE WHERE product_id = 3');
  });

  it('un producto es su propio vecino más cercano (similitud ≈ 1)', async () => {
    const query = await productVector(1);
    const results = await findSimilarProducts(query, 5, { withScores: true });
    expect(results[0].product_id).toBe(1);
    expect(results[0].similarity).toBeCloseTo(1, 5);
  });

  it('ordena por similitud descendente y coincide con el coseno calculado en JS', async () => {
    const query = await productVector(5);
    const results = await findSimilarProducts(query, 10, { withScores: true });
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity - 1e-9);
    }
    const second = await productVector(results[1].product_id);
    expect(results[1].similarity).toBeCloseTo(cosineSimilarity(query, second), 5);
  });

  it('respeta topK y devuelve ids por defecto', async () => {
    const query = await productVector(1);
    const ids = await findSimilarProducts(query, 7);
    expect(ids).toHaveLength(7);
    ids.forEach((id) => expect(typeof id).toBe('number'));
  });

  it('excluye productos (feedback negativo) dentro de la consulta SQL', async () => {
    const query = await productVector(1);
    const ids = await findSimilarProducts(query, 50, { excludeProductIds: [1, 2] });
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
  });

  it('limita la búsqueda a un pool de candidatos', async () => {
    const query = await productVector(1);
    const ids = await findSimilarProducts(query, 50, { candidateProductIds: [4, 9, 12] });
    expect(new Set(ids)).toEqual(new Set([4, 9, 12]));
  });

  it('ignora productos inactivos', async () => {
    await pool.query('UPDATE products SET is_active = FALSE WHERE product_id = 3');
    const query = await productVector(3);
    const ids = await findSimilarProducts(query, 50);
    expect(ids).not.toContain(3);
  });

  it('toPgVector valida dimensión y valores', () => {
    expect(() => toPgVector([1, 2, 3])).toThrow(/768/);
    const bad = new Array(768).fill(0.1);
    bad[10] = Number.NaN;
    expect(() => toPgVector(bad)).toThrow(/finitos/);
    expect(toPgVector(new Array(768).fill(0.5))).toMatch(/^\[0\.5,0\.5/);
  });
});
