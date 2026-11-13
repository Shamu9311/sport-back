import { describe, it, expect, beforeAll } from 'vitest';
import pool from '../../config/db.js';
import { normalizeProducts, loadCatalogs, parseOtherComponents, buildAliasIndex } from '../../scripts/lib/ingredientNormalizer.js';
import { loadProductsForNormalization } from '../../scripts/lib/ingredientStore.js';
import { resetEvidenceAndIngredients, normalizeCatalog, withClient } from './helpers.js';

describe('Migración 008 y normalización de ingredientes', () => {
  let normalization;

  beforeAll(async () => {
    await resetEvidenceAndIngredients();
    const products = await withClient((c) => loadProductsForNormalization(c));
    normalization = normalizeProducts(products, loadCatalogs());
  });

  const itemsOf = (id) => normalization.byProduct[id].items;
  const reviewsOf = (id) => normalization.byProduct[id].reviews;

  it('crea las tablas de ingredientes y formulaciones con sus restricciones', async () => {
    const { rows } = await pool.query(`SELECT to_regclass('ingredients') a, to_regclass('product_ingredients') b,
      to_regclass('formulations') c, to_regclass('product_formulations') d, to_regclass('ingredient_mapping_review') e`);
    expect(Object.values(rows[0]).every(Boolean)).toBe(true);
    // other_components se conserva
    const { rows: col } = await pool.query(`SELECT 1 FROM information_schema.columns
      WHERE table_name = 'product_nutrition' AND column_name = 'other_components'`);
    expect(col).toHaveLength(1);
  });

  it('normaliza datos confiables desde columnas y texto', () => {
    expect(itemsOf(2)).toContainEqual(expect.objectContaining({ ingredient_code: 'caffeine', amount: 75, unit: 'mg' }));
    expect(itemsOf(5)).toContainEqual(expect.objectContaining({ ingredient_code: 'citicoline', amount: 250, unit: 'mg' }));
    expect(itemsOf(15)).toContainEqual(expect.objectContaining({ ingredient_code: 'vitamin_d', amount: 10, unit: 'ug' }));
    expect(itemsOf(49).map((i) => i.ingredient_code)).toEqual(expect.arrayContaining(['vitamin_c', 'zinc', 'iron']));
    // macronutrientes como componentes normalizados
    expect(itemsOf(11)).toContainEqual(expect.objectContaining({ ingredient_code: 'protein', amount: 20, unit: 'g' }));
    expect(itemsOf(4)).toContainEqual(expect.objectContaining({ ingredient_code: 'carbohydrate', amount: 40, unit: 'g' }));
  });

  it('distingue la base de la cantidad (por porción, por 100 g, por unidad)', () => {
    const carbs18 = itemsOf(18).filter((i) => i.ingredient_code === 'carbohydrate').map((i) => i.basis).sort();
    expect(carbs18).toEqual(['per_100g', 'per_unit']);
  });

  it('una mención sin cantidad no duplica la fila de la columna (solo aporta la forma)', () => {
    const caffeine21 = itemsOf(21).filter((i) => i.ingredient_code === 'caffeine');
    expect(caffeine21).toHaveLength(1);
    expect(caffeine21[0]).toMatchObject({ amount: 100, form: 'anhydrous' });
  });

  it('detecta formulaciones declaradas (maltodextrina:fructosa 1:0.8)', () => {
    const products = normalization.productFormulations.map((f) => f.product_id).sort((a, b) => a - b);
    expect(products).toEqual([4, 17, 25]);
  });

  it('envía a revisión los datos ambiguos y NO los normaliza', () => {
    // sodio inverosímil en mg (probables gramos)
    expect(itemsOf(6).some((i) => i.ingredient_code === 'sodium')).toBe(false);
    expect(reviewsOf(6)[0].reason).toMatch(/sodio/i);
    // variantes "+ Nootropics" sin cafeína
    expect(reviewsOf(27).some((r) => r.suggested_code === 'caffeine')).toBe(true);
    expect(itemsOf(27).some((i) => i.ingredient_code === 'caffeine')).toBe(false);
    // texto contradictorio con la columna
    expect(reviewsOf(16).some((r) => /contradictorios/.test(r.reason))).toBe(true);
    // paréntesis incoherente: se registra BCAA 4 g pero no la leucina
    expect(itemsOf(12)).toContainEqual(expect.objectContaining({ ingredient_code: 'bcaa', amount: 4 }));
    expect(itemsOf(12).some((i) => i.ingredient_code === 'leucine')).toBe(false);
    // descriptores comerciales y mezclas genéricas
    expect(reviewsOf(26)[0].reason).toMatch(/no se asume 1:0.8/);
    expect(reviewsOf(33).some((r) => r.suggested_code === 'electrolytes')).toBe(true);
  });

  it('nunca inventa cantidades: las menciones sin cantidad quedan con amount NULL', () => {
    const whey = itemsOf(39).find((i) => i.ingredient_code === 'whey_protein');
    expect(whey).toMatchObject({ amount: null, unit: null });
  });

  it('el analizador de texto reconoce alias en español e inglés', () => {
    const index = buildAliasIndex(loadCatalogs().ingredients);
    const { items } = parseOtherComponents('Leucina 2g, Isoleucina 1g, Valina 1g', index);
    expect(items.map((i) => [i.code, i.amount, i.unit])).toEqual([
      ['leucine', 2, 'g'], ['isoleucine', 1, 'g'], ['valine', 1, 'g'],
    ]);
  });

  it('aplicar la normalización es idempotente y respeta las filas revisadas manualmente', async () => {
    const first = await normalizeCatalog();
    expect(first.counts.inserted).toBe(normalization.productIngredients.length);
    const second = await normalizeCatalog();
    expect(second.counts).toMatchObject({ inserted: 0, updated: 0, deleted: 0, reviews_new: 0 });
    expect(second.counts.unchanged).toBe(normalization.productIngredients.length);

    const { rows: reviews } = await pool.query('SELECT COUNT(*)::int n FROM ingredient_mapping_review');
    expect(reviews[0].n).toBe(normalization.reviews.length);
    const { rows: ambiguous } = await pool.query(`SELECT COUNT(*)::int n FROM product_ingredients pi
      JOIN ingredients i USING (ingredient_id) WHERE pi.product_id = 6 AND i.code = 'sodium'`);
    expect(ambiguous[0].n).toBe(0);

    // Una fila corregida manualmente no se sobrescribe
    await pool.query(`UPDATE product_ingredients SET amount = 80, data_source = 'manual', review_status = 'reviewed'
      WHERE product_id = 2 AND ingredient_id = (SELECT ingredient_id FROM ingredients WHERE code = 'caffeine')`);
    await normalizeCatalog();
    const { rows: manual } = await pool.query(`SELECT amount FROM product_ingredients
      WHERE product_id = 2 AND ingredient_id = (SELECT ingredient_id FROM ingredients WHERE code = 'caffeine')`);
    expect(Number(manual[0].amount)).toBe(80);
  }, 240000); // ~250 escrituras por ejecución contra la BD remota de test

  it('una cantidad sin unidad es rechazada por la base de datos', async () => {
    await expect(pool.query(`INSERT INTO product_ingredients (product_id, ingredient_id, amount, data_source)
      VALUES (1, (SELECT ingredient_id FROM ingredients WHERE code = 'taurine'), 5, 'manual')`))
      .rejects.toMatchObject({ code: '23514' });
  });
});
