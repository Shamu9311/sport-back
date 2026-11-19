import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../config/db.js';
import { ingestFiles } from '../../scripts/ingestEvidence.js';
import { findPendingChunks } from '../../scripts/lib/evidenceEmbeddings.js';
import {
  searchEvidenceChunks, getClaimsForSubjects, getTimingSupport, getProvenance, isEvidenceRagEnabled,
} from '../../services/evidenceRetrievalService.js';
import { fromPgVector } from '../../services/vectorUtils.js';
import { EXAMPLE_FILES, resetEvidenceAndIngredients, normalizeCatalog, withClient, ingredientId, silent } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function chunkVector(chunkKey, sourceKey) {
  const { rows } = await pool.query(`SELECT ch.embedding::text AS e FROM evidence_chunks ch
    JOIN evidence_sources s USING (source_id) WHERE ch.chunk_key = $1 AND s.source_key = $2`, [chunkKey, sourceKey]);
  return fromPgVector(rows[0].e);
}

async function review(sourceKey, status = 'reviewed') {
  await pool.query(`UPDATE evidence_sources SET review_status = $2 WHERE source_key = $1`, [sourceKey, status]);
  await pool.query(`UPDATE evidence_claims SET review_status = $2
    WHERE source_id = (SELECT source_id FROM evidence_sources WHERE source_key = $1)`, [sourceKey, status]);
}

describe('Embeddings y recuperación de evidencia (servicio aislado)', () => {
  beforeAll(async () => {
    await resetEvidenceAndIngredients();
    await normalizeCatalog();
    await withClient((c) => ingestFiles(c, Object.values(EXAMPLE_FILES), { confirm: true, allowExamples: true, log: silent }));
    await review('example-guideline-issn-caffeine');
    await review('example-scientific-crossover-trial');
    // el ejemplo del fabricante queda en draft
  }, 240000); // normalización (~250 consultas) + ingesta + embeddings contra la BD remota de test

  it('todos los chunks tienen embedding de 768 dimensiones, norma > 0 y modelo registrado', async () => {
    const { rows } = await pool.query(`SELECT vector_dims(embedding) d, vector_norm(embedding) n, embedding_model m,
      embedded_content_hash = content_hash AS fresh FROM evidence_chunks`);
    expect(rows).toHaveLength(7);
    rows.forEach((r) => {
      expect(r.d).toBe(768);
      expect(Number(r.n)).toBeGreaterThan(0);
      expect(r.m).toBe(process.env.EMBEDDING_MODEL || 'gemini-embedding-001');
      expect(r.fresh).toBe(true);
    });
    await expect(pool.query(`UPDATE evidence_chunks SET embedding = array_fill(0, ARRAY[768])::vector`))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('la búsqueda vectorial (<=>) devuelve el fragmento más similar con su procedencia', async () => {
    const query = await chunkVector('results-time-trial', 'example-scientific-crossover-trial');
    const results = await searchEvidenceChunks(query, { topK: 3 });
    expect(results[0]).toMatchObject({ source_key: 'example-scientific-crossover-trial', heading: 'Rendimiento en contrarreloj' });
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[0].doi).toBe('10.5555/example.2024.001');
  });

  it('filtra por ingredientes de los productos candidatos', async () => {
    const query = await chunkVector('results-time-trial', 'example-scientific-crossover-trial');
    const results = await searchEvidenceChunks(query, { topK: 10, ingredientIds: [await ingredientId('caffeine')] });
    expect(new Set(results.map((r) => r.source_key))).toEqual(new Set(['example-guideline-issn-caffeine']));
  });

  it('solo utiliza evidencia reviewed: draft y retired quedan excluidas', async () => {
    const manufacturerQuery = await chunkVector('composition', 'example-manufacturer-beta-fuel-gel');
    const draft = await searchEvidenceChunks(manufacturerQuery, { topK: 20 });
    expect(draft.map((r) => r.source_key)).not.toContain('example-manufacturer-beta-fuel-gel');

    await review('example-scientific-crossover-trial', 'retired');
    const query = await chunkVector('results-time-trial', 'example-scientific-crossover-trial');
    const retired = await searchEvidenceChunks(query, { topK: 20 });
    expect(retired.map((r) => r.source_key)).not.toContain('example-scientific-crossover-trial');
    const claims = await getClaimsForSubjects({ formulationIds: [1] });
    expect(claims).toHaveLength(0);
    await pool.query(`UPDATE evidence_chunks SET embedding = NULL, embedding_model = NULL
      WHERE source_id = (SELECT source_id FROM evidence_sources WHERE source_key = 'example-scientific-crossover-trial')`);
    const pending = await withClient((c) => findPendingChunks(c));
    expect(pending.map((p) => p.source_key)).not.toContain('example-scientific-crossover-trial'); // retired: no se embebe
  });

  it('devuelve claims revisados por ingrediente y su procedencia (DOI/PMID/URL)', async () => {
    const claims = await getClaimsForSubjects({ ingredientIds: [await ingredientId('caffeine')] });
    expect(claims.map((c) => c.claim_key)).toEqual(['caffeine-dose-pre-exercise']);
    const provenance = await getProvenance({ claimId: claims[0].claim_id });
    expect(provenance).toMatchObject({ doi: '10.1186/s12970-020-00383-4', pmid: '33388079', source_category: 'official_guideline' });
  });

  it('timing: strong/moderate pueden justificar un momento; limited y not_assessed no', async () => {
    const caffeine = await ingredientId('caffeine');
    const justify = async () => (await getTimingSupport({ ingredientIds: [caffeine] }))
      .filter((r) => r.timing === 'pre').map((r) => r.can_justify_timing);

    expect(await justify()).toEqual([true]); // moderate
    for (const [strength, expected] of [['strong', true], ['limited', false], ['not_assessed', false]]) {
      await pool.query(`UPDATE evidence_claims SET timing_evidence_strength = $1 WHERE claim_key = 'caffeine-dose-pre-exercise'`, [strength]);
      expect(await justify()).toEqual([expected]);
    }
    await pool.query(`UPDATE evidence_claims SET timing_evidence_strength = 'moderate' WHERE claim_key = 'caffeine-dose-pre-exercise'`);
  });

  it('las instrucciones del fabricante no crean elegibilidad de momento', async () => {
    await review('example-manufacturer-beta-fuel-gel');
    const rows = await getTimingSupport({ productIds: [4] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.can_justify_timing === false)).toBe(true);
  });

  it('daily_chronic nunca se deriva de la categoría "diario" del catálogo', async () => {
    const { rows: daily } = await pool.query(`SELECT p.product_id FROM products p JOIN product_types pt USING (type_id)
      JOIN product_categories pc USING (category_id) WHERE pc.usage_context = 'diario'`);
    const support = await getTimingSupport({ productIds: daily.map((d) => d.product_id) });
    expect(support.filter((r) => r.timing === 'daily_chronic')).toHaveLength(0);
    const { rows } = await pool.query(`SELECT COUNT(*)::int n FROM v_claim_timing_support WHERE timing = 'daily_chronic'`);
    expect(rows[0].n).toBe(0);
  });

  it('las relaciones derivadas conservan el grado de indirección', async () => {
    const { rows } = await pool.query(`SELECT DISTINCT relation_type, indirection_rank FROM v_product_evidence_derived
      WHERE product_id IN (2, 4, 25) ORDER BY indirection_rank`);
    expect(rows).toEqual(expect.arrayContaining([
      { relation_type: 'formulation', indirection_rank: 2 },
      { relation_type: 'ingredient', indirection_rank: 3 },
      { relation_type: 'manufacturer_specification', indirection_rank: 5 },
    ]));
  });

  it('Evidence RAG está desactivado por defecto y el flujo antiguo no usa la evidencia', () => {
    expect(process.env.USE_EVIDENCE_RAG).toBe('false');
    expect(isEvidenceRagEnabled()).toBe(false);
    // Módulos del flujo antiguo: sin ninguna referencia a la capa de evidencia
    for (const file of ['llmService.js', 'retrievalService.js']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../../services', file), 'utf8');
      expect(src).not.toMatch(/evidenceRetrievalService|evidenceRecommendationService|evidence_/);
    }
    // El servicio de entrenamiento solo entra en Evidence RAG detrás del flag
    const training = fs.readFileSync(path.resolve(__dirname, '../../services/trainingRecommendationService.js'), 'utf8');
    expect(training).toMatch(/const evidenceMode = isEvidenceRagEnabled\(\);/);
    expect(training).toMatch(/if \(evidenceMode\) \{\s*return await this\.generateWithEvidence/);
  });
});
