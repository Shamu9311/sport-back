import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/db.js', () => ({
  default: { query: vi.fn() },
  pool: { query: vi.fn() },
}));

vi.mock('../../models/feedbackModel.js', () => ({
  default: {
    getNegativeFeedbackProducts: vi.fn().mockResolvedValue([5]),
  },
}));

import pool from '../../config/db.js';
import { getCandidateProductsWithSQL } from '../../services/retrievalService.js';

describe('Recuperación SQL alternativa - unitarias', () => {
  beforeEach(() => vi.clearAllMocks());

  const userProfile = {
    user_id: 1,
    primary_goal: 'mejor rendimiento',
    caffeine_tolerance: 'medio',
    dietary_restrictions: 'no',
  };

  it('selecciona candidatos desde la BD', async () => {
    // node-postgres devuelve { rows } (mysql2 devolvía [rows, fields])
    pool.query.mockResolvedValue({
      rows: [
        {
          product_id: 1,
          product_name: 'Gel',
          product_description: 'desc',
          usage_recommendation: 'durante',
          type_name: 'gel',
          category_name: 'energia',
          usage_context: 'durante entrenamiento',
          attributes: 'alto en carbohidrato',
          serving_size: '1',
          energy_kcal: 100,
          protein_g: 0,
          carbs_g: 25,
          sugars_g: 5,
          sodium_mg: 10,
          caffeine_mg: 0,
        },
      ],
    });

    const result = await getCandidateProductsWithSQL(userProfile, [5]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Gel');
  });

  it('aplica límite de 20 candidatos en la consulta', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await getCandidateProductsWithSQL(userProfile);
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toContain(`LIMIT $${params.length}`);
    expect(params[params.length - 1]).toBe(20);
  });

  it('excluye productos con feedback negativo', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await getCandidateProductsWithSQL(userProfile, [5, 8]);
    const sql = pool.query.mock.calls[0][0];
    // PostgreSQL: lista dinámica como array → NOT (id = ANY($1::int[]))
    expect(sql).toMatch(/NOT \(p\.product_id = ANY\(\$1::int\[\]\)\)/);
    expect(pool.query.mock.calls[0][1][0]).toEqual([5, 8]);
  });

  it('aplica filtro de cafeína para tolerancia no', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await getCandidateProductsWithSQL({ ...userProfile, caffeine_tolerance: 'no' });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/caffeine_mg/i);
  });
});
