import { describe, it, expect } from 'vitest';
import { validateSchema, validateBusinessRules, validateManifest } from '../../scripts/lib/evidenceManifest.js';
import { prepareChunks, contentHash, MAX_TOKENS_PER_CHUNK } from '../../scripts/lib/chunker.js';
import { loadExample } from './helpers.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const ctx = {
  ingredientCodes: new Set(['caffeine', 'carbohydrate', 'maltodextrin', 'fructose']),
  formulationCodes: new Set(['maltodextrin_fructose_1_0_8']),
  productIds: new Set([2, 4, 25]),
  categoryIds: new Set([1, 2, 3, 4]),
};

function errorsOf(manifest) {
  const schema = validateSchema(manifest);
  if (schema.length) return schema;
  return validateBusinessRules(manifest, ctx).errors;
}

describe('Contrato JSON v1 (schema + reglas)', () => {
  it.each(['scientific', 'guideline', 'manufacturer'])('el manifiesto de ejemplo "%s" es válido', (kind) => {
    expect(() => validateManifest(loadExample(kind), ctx)).not.toThrow();
  });

  it('rechaza una fuente sin título', () => {
    const m = clone(loadExample('guideline'));
    m.source.title = '   ';
    expect(errorsOf(m).join()).toMatch(/title/);
  });

  it('valida el formato de DOI y PMID y exige una forma de localizar la fuente', () => {
    const m = clone(loadExample('guideline'));
    m.source.doi = 'doi.org/xyz';
    m.source.pmid = 'PMC123';
    const errs = errorsOf(m).join();
    expect(errs).toMatch(/doi/);
    expect(errs).toMatch(/pmid/);

    const noLocator = clone(loadExample('guideline'));
    delete noLocator.source.doi;
    delete noLocator.source.pmid;
    delete noLocator.source.url;
    expect(errorsOf(noLocator).length).toBeGreaterThan(0);
  });

  it('acepta fuentes sin DOI cuando tienen URL oficial', () => {
    const m = clone(loadExample('guideline'));
    delete m.source.doi;
    delete m.source.pmid;
    expect(errorsOf(m)).toEqual([]);
  });

  it('rechaza sample_size negativo o en una ficha del fabricante', () => {
    const m = clone(loadExample('scientific'));
    m.claims[0].sample_size = -3;
    expect(errorsOf(m).join()).toMatch(/sample_size/);

    const f = clone(loadExample('manufacturer'));
    f.claims[0].sample_size = 10;
    expect(errorsOf(f).join()).toMatch(/sample_size/);
  });

  it('rechaza timings inválidos o incoherentes y acepta varios momentos', () => {
    const bad = clone(loadExample('scientific'));
    bad.claims[0].timing_context = ['antes'];
    expect(errorsOf(bad).length).toBeGreaterThan(0);

    const incoherent = clone(loadExample('scientific'));
    incoherent.claims[0].timing_context = ['not_specified', 'pre'];
    expect(errorsOf(incoherent).join()).toMatch(/not_specified/);

    const multi = clone(loadExample('scientific'));
    multi.claims[0].timing_context = ['pre', 'during'];
    expect(errorsOf(multi)).toEqual([]);
  });

  it('rechaza claims sin resultado (result_summary) y eficacia sin outcome', () => {
    const m = clone(loadExample('scientific'));
    delete m.claims[0].result_summary;
    expect(errorsOf(m).join()).toMatch(/result_summary/);
    const o = clone(loadExample('scientific'));
    delete o.claims[0].outcome;
    expect(errorsOf(o).join()).toMatch(/outcome/);
  });

  it('not_applicable: obligatorio en composición/instrucciones y prohibido en eficacia', () => {
    const composition = clone(loadExample('manufacturer'));
    composition.claims[0].effect_direction = 'insufficient';
    expect(errorsOf(composition).length).toBeGreaterThan(0);

    const efficacy = clone(loadExample('scientific'));
    efficacy.claims[0].effect_direction = 'not_applicable';
    expect(errorsOf(efficacy).length).toBeGreaterThan(0);
  });

  it('la ausencia de significancia no puede registrarse como evidencia negativa', () => {
    const m = clone(loadExample('scientific'));
    m.claims[0].effect_direction = 'negative'; // tt-performance es not_significant
    expect(errorsOf(m).length).toBeGreaterThan(0);
  });

  it('una especificación del fabricante nunca aporta eficacia y puede no tener nivel', () => {
    const m = clone(loadExample('manufacturer'));
    m.claims[0].claim_type = 'efficacy';
    m.claims[0].effect_direction = 'positive';
    m.claims[0].outcome = 'rendimiento';
    expect(errorsOf(m).join()).toMatch(/fabricante/);

    const reviewed = clone(loadExample('manufacturer'));
    reviewed.source.review_status = 'reviewed';
    expect(errorsOf(reviewed)).toEqual([]); // sin evidence_level y revisada: válido (ajuste 2)

    const leveled = clone(loadExample('manufacturer'));
    leveled.source.evidence_level = 'A';
    expect(errorsOf(leveled).length).toBeGreaterThan(0);
  });

  it('una fuente científica revisada exige nivel A–D y su justificación', () => {
    const m = clone(loadExample('scientific'));
    m.source.review_status = 'reviewed';
    delete m.source.evidence_level;
    expect(errorsOf(m).join()).toMatch(/evidence_level/);
  });

  it('detecta duplicados, referencias inexistentes y relaciones inválidas', () => {
    const dup = clone(loadExample('scientific'));
    dup.claims.push(clone(dup.claims[0]));
    dup.chunks.push({ ...clone(dup.chunks[0]), chunk_key: 'otro' });
    const dupErrors = errorsOf(dup).join();
    expect(dupErrors).toMatch(/claim_key duplicado/);
    expect(dupErrors).toMatch(/content_hash/);

    const refs = clone(loadExample('guideline'));
    refs.claims[0].ingredient = 'unobtanium';
    refs.product_relations[0].product_id = 999;
    refs.claims[0].chunk_keys = ['no-existe'];
    const refErrors = errorsOf(refs).join();
    expect(refErrors).toMatch(/ingrediente inexistente/);
    expect(refErrors).toMatch(/producto inexistente/);
    expect(refErrors).toMatch(/chunk_key inexistente/);

    const direct = clone(loadExample('guideline'));
    direct.product_relations[0].relation_type = 'direct_product';
    expect(errorsOf(direct).join()).toMatch(/direct_product/);
  });

  it('no permite texto literal completo de fuentes sin licencia abierta', () => {
    const m = clone(loadExample('scientific')); // open_access: false
    m.chunks[2].content_kind = 'verbatim';
    expect(errorsOf(m).join()).toMatch(/licencia/);
  });
});

describe('Chunking', () => {
  it('conserva los fragmentos curados y calcula un hash estable', () => {
    const { rows } = prepareChunks(loadExample('scientific').chunks);
    expect(rows.map((r) => r.chunk_key)).toEqual(['abstract', 'methods-protocol', 'results-time-trial', 'results-gi']);
    expect(rows[0].content_hash).toBe(contentHash(`  ${rows[0].content}  `));
    expect(rows[0].content_hash).toHaveLength(64);
  });

  it('divide por párrafos (nunca a mitad de frase) un fragmento demasiado largo', () => {
    const paragraph = 'Frase de prueba con varias palabras para el conteo. '.repeat(40).trim();
    const content = Array.from({ length: 6 }, () => paragraph).join('\n\n');
    const { rows, keyMap } = prepareChunks([{ chunk_key: 'results', section: 'results', content }]);
    expect(rows.length).toBeGreaterThan(1);
    expect(keyMap.get('results')).toEqual(rows.map((r) => r.chunk_key));
    rows.forEach((r) => {
      expect(r.token_count).toBeLessThanOrEqual(MAX_TOKENS_PER_CHUNK);
      expect(r.content.endsWith('.')).toBe(true);
      expect(r.section).toBe('results');
    });
  });
});
