import { describe, it, expect, beforeAll } from 'vitest';
import pool from '../../config/db.js';
import { ingestFiles } from '../../scripts/ingestEvidence.js';
import { ingestManifest, IngestError } from '../../scripts/lib/evidenceIngest.js';
import { findPendingChunks } from '../../scripts/lib/evidenceEmbeddings.js';
import {
  EXAMPLE_FILES, loadExample, writeTempManifest, resetEvidenceAndIngredients, normalizeCatalog, withClient,
  ingredientId, silent,
} from './helpers.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const count = async (table) => (await pool.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n;
const run = (files, opts = {}) =>
  withClient((c) => ingestFiles(c, files, { confirm: true, allowExamples: true, log: silent, ...opts }));

describe('Ingesta de evidencia (idempotencia, duplicados, relaciones)', () => {
  beforeAll(async () => {
    await resetEvidenceAndIngredients();
    await normalizeCatalog();
  }, 240000); // ~250 consultas contra la BD remota de test

  it('dry-run valida y simula sin escribir nada', async () => {
    const results = await run(Object.values(EXAMPLE_FILES), { confirm: false });
    expect(results.every((r) => r.status === 'success')).toBe(true);
    expect(await count('evidence_sources')).toBe(0);
    expect(await count('evidence_ingest_runs')).toBe(0);
  });

  it('ingiere los tres tipos de fuente con chunks, claims, relaciones y embeddings', async () => {
    const results = await run(Object.values(EXAMPLE_FILES));
    expect(results.map((r) => r.status)).toEqual(['success', 'success', 'success']);
    expect(await count('evidence_sources')).toBe(3);
    expect(await count('evidence_chunks')).toBe(7);
    expect(await count('evidence_claims')).toBe(6);
    expect(await count('product_evidence')).toBe(3);
    expect(await count('evidence_claim_chunks')).toBe(7);
    const { rows } = await pool.query(`SELECT source_key, source_category FROM evidence_sources ORDER BY source_key`);
    expect(rows.map((r) => r.source_category)).toEqual(['official_guideline', 'manufacturer_specification', 'scientific_evidence']);
    expect(await withClient((c) => findPendingChunks(c))).toHaveLength(0);
    expect(await count('evidence_ingest_runs')).toBe(3);
  });

  it('ingerir dos veces el mismo archivo no duplica nada ni regenera embeddings', async () => {
    const before = await pool.query('SELECT chunk_id, embedded_at FROM evidence_chunks ORDER BY chunk_id');
    const results = await run(Object.values(EXAMPLE_FILES));
    for (const r of results) {
      expect(r.summary.source).toBe('unchanged');
      expect(r.summary.chunks).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(r.summary.claims).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(r.summary.relations).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
      expect(r.embeddings.pending).toBe(0);
    }
    const after = await pool.query('SELECT chunk_id, embedded_at FROM evidence_chunks ORDER BY chunk_id');
    expect(after.rows).toEqual(before.rows);
    expect(await count('evidence_sources')).toBe(3);
    expect(await count('evidence_claims')).toBe(6);
  });

  it('rechaza DOI y PMID ya usados por otra fuente sin escribir nada', async () => {
    const dupDoi = clone(loadExample('guideline'));
    dupDoi.source.source_key = 'example-duplicated-doi';
    delete dupDoi.source.pmid;
    const dupPmid = clone(loadExample('guideline'));
    dupPmid.source.source_key = 'example-duplicated-pmid';
    delete dupPmid.source.doi;
    const results = await run([writeTempManifest(dupDoi, 'dup-doi'), writeTempManifest(dupPmid, 'dup-pmid')]);
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(results[0].errors.join()).toMatch(/DOI\/PMID duplicado/);
    expect(results[1].errors.join()).toMatch(/DOI\/PMID duplicado/);
    expect(await count('evidence_sources')).toBe(3);
  });

  it('un error en un archivo no corrompe la ingesta de los demás', async () => {
    const broken = clone(loadExample('scientific'));
    broken.source.source_key = 'example-broken';
    broken.source.doi = '10.5555/example.broken';
    broken.claims[0].ingredient = 'unobtanium';
    const ok = clone(loadExample('scientific'));
    ok.source.source_key = 'example-second-trial';
    ok.source.doi = '10.5555/example.second';
    const results = await run([writeTempManifest(broken, 'broken'), writeTempManifest(ok, 'second')]);
    expect(results.map((r) => r.status)).toEqual(['failed', 'success']);
    const { rows } = await pool.query(`SELECT source_key FROM evidence_sources WHERE source_key LIKE 'example-%' ORDER BY 1`);
    expect(rows.map((r) => r.source_key)).not.toContain('example-broken');
    const { rows: failedRun } = await pool.query(`SELECT status, errors FROM evidence_ingest_runs WHERE source_key = 'example-broken'`);
    expect(failedRun[0].status).toBe('failed');
  });

  it('el manifiesto es la fuente de verdad: cambios de contenido regeneran el embedding y lo eliminado se borra', async () => {
    const m = clone(loadExample('scientific'));
    m.source.source_key = 'example-second-trial';
    m.source.doi = '10.5555/example.second';
    m.chunks[0].content = `${m.chunks[0].content} (contenido revisado)`;
    m.claims = m.claims.filter((c) => c.claim_key !== 'late-nausea');
    const [result] = await run([writeTempManifest(m, 'second-v2')]);
    expect(result.summary.chunks.updated).toBe(1);
    expect(result.summary.claims.deleted).toBe(1);
    expect(result.embeddings.pending).toBe(1);
    expect(result.embeddings.embedded).toBe(1);
  });

  it('almacena resultados positivos, neutros, negativos, mixtos e insuficientes', async () => {
    const m = clone(loadExample('scientific'));
    m.source.source_key = 'example-mixed-results';
    m.source.doi = '10.5555/example.mixed';
    m.claims.push(
      { claim_key: 'mixed-result', claim_type: 'efficacy', formulation: 'maltodextrin_fructose_1_0_8',
        outcome: 'potencia media', effect_direction: 'mixed', statistical_significance: 'not_reported',
        result_summary: 'Resultados contradictorios entre subgrupos (ficticio).', timing_context: ['during'] },
      { claim_key: 'insufficient-result', claim_type: 'efficacy', ingredient: 'carbohydrate',
        outcome: 'rendimiento en mujeres', effect_direction: 'insufficient', statistical_significance: 'not_tested',
        result_summary: 'Evidencia insuficiente en mujeres (ficticio).' }
    );
    const [result] = await run([writeTempManifest(m, 'mixed')]);
    expect(result.status).toBe('success');
    const { rows } = await pool.query(`SELECT DISTINCT effect_direction FROM evidence_claims c
      JOIN evidence_sources s USING (source_id) WHERE s.source_key = 'example-mixed-results' ORDER BY 1`);
    expect(rows.map((r) => r.effect_direction)).toEqual(['insufficient', 'mixed', 'negative', 'neutral', 'positive']);
  });

  it('claims con múltiples momentos se guardan y se consultan por momento', async () => {
    await pool.query(`UPDATE evidence_claims SET timing_context = '{pre,during}' WHERE claim_key = 'caffeine-dose-pre-exercise'`);
    const { rows } = await pool.query(`SELECT claim_key FROM evidence_claims WHERE timing_context @> '{during}'::text[]
      AND claim_key = 'caffeine-dose-pre-exercise'`);
    expect(rows).toHaveLength(1);
    await expect(pool.query(`UPDATE evidence_claims SET timing_context = '{antes}' WHERE claim_key = 'caffeine-dose-pre-exercise'`))
      .rejects.toMatchObject({ code: '23514' });
    await pool.query(`UPDATE evidence_claims SET timing_context = '{pre}' WHERE claim_key = 'caffeine-dose-pre-exercise'`);
  });

  it('la BD rechaza relaciones producto ↔ evidencia no justificadas', async () => {
    const { rows: [g] } = await pool.query(`SELECT s.source_id, c.claim_id FROM evidence_sources s
      JOIN evidence_claims c USING (source_id) WHERE s.source_key = 'example-guideline-issn-caffeine'`);
    const caffeine = await ingredientId('caffeine');
    // Producto 1 (gel isotónico) no contiene cafeína
    await expect(pool.query(`INSERT INTO product_evidence (product_id, source_id, claim_id, relation_type, ingredient_id, rationale)
      VALUES (1, $1, $2, 'ingredient', $3, 'prueba')`, [g.source_id, g.claim_id, caffeine]))
      .rejects.toThrow(/no contiene el ingrediente/);
    // direct_product exige un claim que estudie el producto
    await expect(pool.query(`INSERT INTO product_evidence (product_id, source_id, claim_id, relation_type, rationale)
      VALUES (2, $1, $2, 'direct_product', 'prueba')`, [g.source_id, g.claim_id]))
      .rejects.toThrow(/direct_product/);
    // manufacturer_specification exige una fuente del fabricante
    await expect(pool.query(`INSERT INTO product_evidence (product_id, source_id, relation_type, rationale)
      VALUES (2, $1, 'manufacturer_specification', 'prueba')`, [g.source_id]))
      .rejects.toThrow(/manufacturer_specification/);
  });

  it('la BD impide claims de eficacia en una especificación del fabricante', async () => {
    const { rows: [m] } = await pool.query(`SELECT source_id FROM evidence_sources WHERE source_key = 'example-manufacturer-beta-fuel-gel'`);
    await expect(pool.query(`INSERT INTO evidence_claims (source_id, claim_key, claim_type, product_id, outcome,
        effect_direction, result_summary) VALUES ($1, 'bad', 'efficacy', 4, 'rendimiento', 'positive', 'x')`, [m.source_id]))
      .rejects.toThrow(/fabricante/);
  });

  describe('BD (migración 011): usage_instruction general solo fuera del fabricante', () => {
    // Cada caso se ejecuta en una transacción revertida: no altera los conteos del resto de pruebas.
    const tryInsert = (sourceKey, claim) => withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const { rows: [s] } = await c.query('SELECT source_id FROM evidence_sources WHERE source_key = $1', [sourceKey]);
        await c.query(`INSERT INTO evidence_claims (source_id, claim_key, claim_type, effect_direction, outcome,
            result_summary, ingredient_id, product_id) VALUES ($1, 'test-011', $2, $3, $4, 'prueba', $5, $6)`,
        [s.source_id, claim.type, claim.effect, claim.outcome ?? null, claim.ingredientId ?? null, claim.productId ?? null]);
        return 'ok';
      } finally {
        await c.query('ROLLBACK');
      }
    });
    const general = { type: 'usage_instruction', effect: 'not_applicable' };

    it('1. acepta usage_instruction sin sujeto en una fuente scientific_evidence', async () => {
      await expect(tryInsert('example-scientific-crossover-trial', general)).resolves.toBe('ok');
    });

    it('2. acepta usage_instruction sin sujeto en una fuente official_guideline', async () => {
      await expect(tryInsert('example-guideline-issn-caffeine', general)).resolves.toBe('ok');
    });

    it('3. rechaza usage_instruction sin sujeto en una manufacturer_specification', async () => {
      await expect(tryInsert('example-manufacturer-beta-fuel-gel', general))
        .rejects.toThrow(/solo se admite en fuentes scientific_evidence u official_guideline/);
      await expect(tryInsert('example-manufacturer-beta-fuel-gel', { ...general, productId: 4 })).resolves.toBe('ok');
      await expect(tryInsert('example-manufacturer-beta-fuel-gel', { ...general, ingredientId: await ingredientId('carbohydrate') }))
        .resolves.toBe('ok');
    });

    it('4. rechaza claims de eficacia sin sujeto (CHECK evidence_claims_subject)', async () => {
      const efficacy = { type: 'efficacy', effect: 'positive', outcome: 'rendimiento' };
      for (const key of ['example-scientific-crossover-trial', 'example-guideline-issn-caffeine']) {
        await expect(tryInsert(key, efficacy)).rejects.toMatchObject({ code: '23514', constraint: 'evidence_claims_subject' });
      }
    });
  });

  it('la composición declarada por el fabricante queda trazable a su fuente', async () => {
    const { rows } = await pool.query(`SELECT i.code, pi.data_source, s.source_key FROM product_ingredients pi
      JOIN ingredients i USING (ingredient_id) JOIN evidence_sources s ON s.source_id = pi.source_id
      WHERE pi.product_id = 4 ORDER BY i.code`);
    expect(rows.map((r) => r.code)).toEqual(['carbohydrate', 'fructose', 'maltodextrin']);
    expect(rows.every((r) => r.data_source === 'manufacturer_specification')).toBe(true);
  });

  it('una fuente de ejemplo no se ingiere fuera de test sin autorización explícita', async () => {
    await withClient(async (c) => {
      await c.query('BEGIN');
      await expect(ingestManifest(c, loadExample('guideline'), { allowExamples: false })).rejects.toBeInstanceOf(IngestError);
      await c.query('ROLLBACK');
    });
  });
});
