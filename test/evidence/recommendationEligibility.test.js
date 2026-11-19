// Pruebas unitarias (puras) de la elegibilidad Evidence RAG: no usan base de datos.
import { describe, it, expect } from 'vitest';
import {
  computeEligibility, selectRecommendations, normalizeSession, resolveDose, MAX_RECOMMENDATIONS,
} from '../../services/evidenceEligibilityService.js';
import { buildEvidenceContext, validateEvidenceResponse, buildDeterministicResponse } from '../../services/evidencePromptService.js';

// Matriz rol → nutriente → fases (misma que la migración 014)
const roleMatrix = {
  fueling: { carbohydrate: ['pre', 'during'], caffeine: ['pre', 'during'], sodium: ['pre', 'during'] },
  hydration: { sodium: ['pre', 'during', 'post'], caffeine: ['pre', 'during'] },
  recovery: { protein: ['pre', 'post'], carbohydrate: ['post'] },
};
const ING = { carbohydrate: 1, protein: 2, caffeine: 6, sodium: 7, creatine_monohydrate: 30 };
const ing = (code, amount, unit, serving = '1 porción') => ({ code, ingredient_id: ING[code], amount, unit, basis: 'per_serving', serving_description: serving });
const product = (id, roles, nutrients, ingredients, extra = {}) => ({
  product_id: id, name: `Producto ${id}`, type_name: 'tipo', roles, nutrients, ingredients, formulation_ids: [], instructions: [], ...extra,
});
let nextClaim = 100;
const claim = (over) => ({
  claim_id: nextClaim++, source_id: 1, claim_type: 'dosage_guideline', effect_direction: 'positive',
  timing_evidence_strength: 'moderate', source_evidence_level: 'A', source_title: 'Fuente A', source_year: 2020,
  result_summary: 'Resumen', conditions: {}, timing_context: [], justified_timings: [], chunk_ids: [], ...over,
});
const withIngredient = (code, over) => claim({ ingredient_id: ING[code], ingredient_code: code,
  ingredient_category: ['carbohydrate', 'protein'].includes(code) ? 'macronutrient' : 'other', ...over });

const choRate = withIngredient('carbohydrate', { source_id: 10, timing_context: ['during'], justified_timings: ['during'],
  dose_value: 30, dose_value_max: 60, dose_unit: 'g/h', conditions: { min_exercise_minutes: 60, max_exercise_minutes: 150 } });
const choUltra = withIngredient('carbohydrate', { source_id: 10, timing_context: ['during'], justified_timings: ['during'],
  dose_value: null, dose_value_max: 90, dose_unit: 'g/h', conditions: { min_exercise_minutes: 150 } });
const caf36 = withIngredient('caffeine', { source_id: 20, timing_context: ['pre'], justified_timings: ['pre'], dose_value: 3, dose_value_max: 6, dose_unit: 'mg/kg' });
const cafLow = withIngredient('caffeine', { source_id: 21, timing_context: ['pre', 'during'], justified_timings: ['pre', 'during'], dose_value: null, dose_value_max: 3, dose_unit: 'mg/kg' });
const cafMin = withIngredient('caffeine', { source_id: 20, timing_context: ['not_specified'], justified_timings: [], dose_value: 2, dose_value_max: 3, dose_unit: 'mg/kg', evidence_strength: 'C', timing_evidence_strength: 'not_assessed' });
const protTiming = withIngredient('protein', { source_id: 30, claim_type: 'timing_guideline', timing_context: ['pre', 'post'], justified_timings: ['pre', 'post'] });
const protDose = withIngredient('protein', { source_id: 30, timing_context: ['daily_chronic', 'flexible'], justified_timings: ['daily_chronic'], dose_value: 20, dose_value_max: 40, dose_unit: 'g' });
const protDaily = withIngredient('protein', { source_id: 30, timing_context: ['daily_chronic'], justified_timings: ['daily_chronic'], dose_value: 1.4, dose_value_max: 2, dose_unit: 'g/kg/day' });
const naContext = withIngredient('sodium', { source_id: 40, claim_type: 'timing_guideline', timing_context: ['pre', 'during', 'post'], justified_timings: ['pre', 'during', 'post'], conditions: { any_of: [{ environment: ['heat'] }, { sweat_loss: ['high'] }] } });
const naDose = withIngredient('sodium', { source_id: 40, timing_context: ['during'], justified_timings: [], timing_evidence_strength: 'limited', effect_direction: 'mixed', dose_value: 500, dose_value_max: 700, dose_unit: 'mg/L' });
const creatine = withIngredient('creatine_monohydrate', { source_id: 50, timing_context: ['daily_chronic'], justified_timings: ['daily_chronic'], dose_value: 3, dose_value_max: 5, dose_unit: 'g/day' });
const ALL_CLAIMS = [choRate, choUltra, caf36, cafLow, cafMin, protTiming, protDose, protDaily, naContext, naDose, creatine];

const verifiedGel = (id, perHour = 3) => product(id, ['fueling'], ['carbohydrate'], [ing('carbohydrate', 40, 'g')], {
  instructions: [{ claim_id: 900 + id, source_id: 99, timing_context: ['during'], dose_unit: 'servings_per_hour', dose_value: 1, dose_value_max: perHour, frequency: `1–${perHour} por hora` }],
});
const unverifiedGel = product(2, ['fueling'], ['carbohydrate'], [ing('carbohydrate', 40, 'g')]);
const immune = product(3, ['no_fueling'], [], [ing('carbohydrate', 2, 'g'), ing('sodium', 300, 'mg', '500ml drink')]);
const rego = product(4, ['recovery'], ['protein', 'carbohydrate'], [ing('protein', 24, 'g'), ing('carbohydrate', 38, 'g')]);
const caffeineGel = product(5, ['fueling'], ['carbohydrate', 'caffeine'], [ing('caffeine', 200, 'mg'), ing('carbohydrate', 40, 'g')]);
const caffeine75 = product(6, ['fueling'], ['carbohydrate', 'caffeine'], [ing('caffeine', 75, 'mg'), ing('carbohydrate', 22, 'g')]);
const drink = product(7, ['fueling', 'hydration'], ['carbohydrate', 'sodium'], [ing('sodium', 500, 'mg', '500ml drink'), ing('carbohydrate', 36, 'g', '500ml drink')]); // 1000 mg/L
const drink600 = product(14, ['hydration'], ['sodium'], [ing('sodium', 300, 'mg', '500ml drink')]); // 600 mg/L
const bcaa = product(8, ['no_fueling'], [], [ing('protein', 4, 'g')]);

const run = (products, sessionData, profile = { weight: 70 }, claims = ALL_CLAIMS) =>
  computeEligibility({ products, claims, roleMatrix }, normalizeSession(sessionData, profile));
const pairs = (result, phase) => result.eligible.filter((e) => e.phase === phase);
const S90 = { durationMin: 90, intensity: 'alto', weather: 'moderado', type: 'resistencia' };

describe('Evidence RAG — elegibilidad (reglas del diseño aprobado)', () => {
  it('carbohidrato durante: porciones/h dinámicas y solo con cadencia oficial verificada', () => {
    const r = run([verifiedGel(1), unverifiedGel], S90);
    const during = pairs(r, 'durante');
    expect(during.map((p) => p.product_id)).toEqual([1]);
    expect(during[0].status).toBe('cadence_verified');
    expect(during[0].plan.servings_per_hour).toEqual([0.8, 1.5]); // 30–60 g/h ÷ 40 g
    expect(r.rejected.some((x) => x.product_id === 2 && x.timing === 'during' && /cadence_unverified/.test(x.reason))).toBe(true);
  });

  it('>150 min: hasta 90 g/h solo con formulación de varios carbohidratos; sin ella se limita a 60 g/h', () => {
    const multi = { ...verifiedGel(1), formulation_ids: [1] };
    const single = verifiedGel(9);
    const r = run([multi, single], { ...S90, durationMin: 180 });
    expect(pairs(r, 'durante').find((p) => p.product_id === 1).plan.servings_per_hour).toEqual([0.8, 2.3]);
    expect(pairs(r, 'durante').find((p) => p.product_id === 9).plan.servings_per_hour).toEqual([0.8, 1.5]);
  });

  it('la cadencia oficial limita: si el objetivo mínimo exige más porciones de las permitidas, no es viable', () => {
    const r = run([product(11, ['fueling'], ['carbohydrate'], [ing('carbohydrate', 5, 'g')], {
      instructions: [{ claim_id: 911, source_id: 99, timing_context: ['during'], dose_unit: 'servings_per_hour', dose_value_max: 3 }] })], S90);
    expect(pairs(r, 'durante')).toHaveLength(0);
    expect(r.rejected.some((x) => /porciones\/h y la ficha permite 3/.test(x.reason))).toBe(true);
  });

  it('BCAA, IMMUNE y multivitamínicos (no_fueling) nunca aportan combustible aunque tengan carbohidrato', () => {
    const r = run([immune, bcaa], { ...S90, weather: 'calido' });
    expect(r.eligible).toHaveLength(0);
    expect(r.rejected.filter((x) => x.reason === 'rol no_fueling')).toHaveLength(2);
  });

  it('recovery no pasa a "durante" por su carbohidrato; sí antes/después por proteína ≥20 g (1 porción)', () => {
    const r = run([rego], S90);
    expect(pairs(r, 'durante')).toHaveLength(0);
    expect(pairs(r, 'antes').map((p) => p.nutrient)).toEqual(['protein']);
    const post = pairs(r, 'despues')[0];
    expect(post).toMatchObject({ nutrient: 'protein', status: 'cadence_unverified' });
    expect(post.plan.servings).toBe(1);
  });

  it('cafeína: 3–6 mg/kg es la banda principal; 2–<3 mg/kg solo contextual (claim de dosis mínima)', () => {
    const at60 = run([caffeineGel], S90, { weight: 60 });
    expect(pairs(at60, 'antes').find((p) => p.nutrient === 'caffeine')).toMatchObject({ tier: 'principal' }); // 3.33 mg/kg
    const at70 = run([caffeineGel], S90, { weight: 70 });
    const pre70 = pairs(at70, 'antes').find((p) => p.nutrient === 'caffeine');
    expect(pre70).toMatchObject({ tier: 'contextual' }); // 2.86 mg/kg
    expect(pre70.plan.dose_mg_per_kg).toBe(2.86);
    expect(pre70.score).toBeLessThan(pairs(at60, 'antes').find((p) => p.nutrient === 'caffeine').score);
  });

  it('sin el claim de dosis mínima revisado, la banda 2–<3 mg/kg no existe', () => {
    const r = run([caffeineGel], S90, { weight: 70 }, ALL_CLAIMS.filter((c) => c !== cafMin));
    expect(pairs(r, 'antes').filter((p) => p.nutrient === 'caffeine')).toHaveLength(0);
  });

  it('no suma porciones de cafeína sin cadencia verificada para alcanzar la dosis', () => {
    const r = run([caffeine75], S90, { weight: 70 }); // 75 mg = 1.07 mg/kg
    expect(r.eligible.filter((p) => p.nutrient === 'caffeine')).toHaveLength(0);
    expect(r.rejected.some((x) => x.nutrient === 'caffeine' && /requiere cadencia oficial verificada/.test(x.reason))).toBe(true);
  });

  it('una instrucción oficial revisada que no contempla la fase la restringe', () => {
    const restricted = { ...rego, instructions: [{ claim_id: 940, source_id: 99, timing_context: ['post'], dose_unit: null }] };
    const r = run([restricted], S90);
    expect(pairs(r, 'antes')).toHaveLength(0);
    expect(pairs(r, 'despues')).toHaveLength(1);
  });

  it('sodio: se habilita con calor O sudoración alta; no con humedad ni en condiciones normales', () => {
    const sodium = (r) => r.eligible.filter((p) => p.nutrient === 'sodium');
    expect(sodium(run([drink600], S90, { weight: 70, sweat_level: 'medio' }))).toHaveLength(0);
    expect(sodium(run([drink600], { ...S90, weather: 'humedo' }, { weight: 70, sweat_level: 'medio' }))).toHaveLength(0);
    const hot = run([drink600], { ...S90, weather: 'calido' }, { weight: 70, sweat_level: 'medio' });
    expect(pairs(hot, 'durante').find((p) => p.nutrient === 'sodium').plan.concentration_mg_per_l).toBe(600);
    const sweaty = run([drink600], S90, { weight: 70, sweat_level: 'alto' });
    expect(sodium(sweaty).map((p) => p.phase).sort()).toEqual(['antes', 'despues', 'durante']);
  });

  it('sodio: 500–700 mg/L es un rango; por encima no lo respalda el claim general (sin inventar dosis mayores)', () => {
    const r = run([drink], { ...S90, weather: 'calido' }, { weight: 70, sweat_level: 'alto' });
    expect(r.eligible.filter((p) => p.nutrient === 'sodium')).toHaveLength(0);
    expect(r.rejected.some((x) => x.nutrient === 'sodium' && x.reason.includes('1000 mg/L supera el rango respaldado (500–700 mg/L)'))).toBe(true);
    const ok = run([drink600], { ...S90, weather: 'calido' });
    expect(pairs(ok, 'durante')[0].plan.target_mg_per_l).toEqual([500, 700]);
  });

  it('daily_chronic nunca se deriva de guías de macronutrientes ni sin cadencia verificada', () => {
    const r = run([rego, product(12, ['recovery'], ['protein', 'creatine_monohydrate'], [ing('creatine_monohydrate', 5, 'g')])], S90);
    expect(pairs(r, 'diario')).toHaveLength(0);
    expect(r.rejected.some((x) => /macronutrientes/.test(x.reason))).toBe(true);
  });

  it('resolveDose hereda la dosis por toma de la misma fuente, no la guía diaria total', () => {
    const dose = resolveDose(protTiming, 'post', ALL_CLAIMS);
    expect(dose).toMatchObject({ kind: 'per_intake', lo: 20, unit: 'g' });
  });

  it('la evidencia neutral/insuficiente matiza o impide la recomendación', () => {
    const multi = { ...verifiedGel(1), formulation_ids: [1] };
    const weakCaveat = claim({ source_id: 60, formulation_id: 1, effect_direction: 'neutral', timing_context: ['during'], source_evidence_level: 'C' });
    const matizada = run([multi], S90, { weight: 70 }, [...ALL_CLAIMS, weakCaveat]);
    expect(pairs(matizada, 'durante')[0].caveats.map((c) => c.claim.claim_id)).toContain(weakCaveat.claim_id);
    const strongCaveats = [1, 2, 3].map((i) => claim({ source_id: 70 + i, ingredient_id: ING.carbohydrate, ingredient_code: 'carbohydrate',
      effect_direction: 'insufficient', timing_context: ['during'], source_evidence_level: 'A' }));
    const weakSupport = { ...choRate, source_evidence_level: 'D' };
    const blocked = run([verifiedGel(1)], S90, { weight: 70 }, [weakSupport, ...strongCaveats]);
    expect(pairs(blocked, 'durante')).toHaveLength(0);
    expect(blocked.rejected.some((x) => /neutral\/insuficiente/.test(x.reason))).toBe(true);
  });

  it('no fuerza cuatro recomendaciones: puede devolver solo una', () => {
    const r = run([verifiedGel(1)], S90);
    expect(selectRecommendations(r.eligible).map((s) => s.phase)).toEqual(['durante']);
  });

  it('devuelve 1, 2, 3 o más recomendaciones válidas hasta el máximo (durante ≤ 2, nutrientes distintos)', () => {
    const r = run([verifiedGel(1), rego, drink600, caffeineGel, { ...verifiedGel(13), product_id: 13 }], { ...S90, weather: 'calido' }, { weight: 60 });
    const sel = selectRecommendations(r.eligible);
    expect(sel.length).toBeGreaterThanOrEqual(3);
    expect(sel.length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS);
    const during = sel.filter((s) => s.phase === 'durante');
    expect(during.length).toBeLessThanOrEqual(2);
    expect(new Set(during.map((d) => d.nutrient)).size).toBe(during.length);
    expect(new Set(sel.map((s) => s.product_id)).size).toBe(sel.length);
  });
});

describe('Evidence RAG — validación de la respuesta del LLM', () => {
  const r = run([verifiedGel(1), rego], S90);
  const shortlist = r.eligible;
  const { refs } = buildEvidenceContext({ profile: {}, session: normalizeSession(S90, { weight: 70 }), shortlist, chunksByClaim: new Map() });
  const refOf = (claimId) => [...refs.claims.values()].find((c) => c.claim.claim_id === claimId).ref;
  const productRef = (id, phase) => [...refs.products.values()].find((p) => p.pair.product_id === id && p.pair.phase === phase).ref;

  it('acepta una recomendación de un par elegible que cita un claim recuperado', () => {
    const { accepted } = validateEvidenceResponse({ recommendations: [
      { product_ref: productRef(1, 'durante'), product_id: 1, consumption_timing: 'durante', evidence: [{ claim_ref: refOf(choRate.claim_id), role: 'supports' }] },
    ] }, { refs, shortlist });
    expect(accepted).toHaveLength(1);
  });

  it('rechaza productos que no son candidatos/elegibles, claims inexistentes y claims de otro producto', () => {
    const { accepted, discarded } = validateEvidenceResponse({ recommendations: [
      { product_id: 777, consumption_timing: 'durante', evidence: [{ claim_ref: refOf(choRate.claim_id) }] },
      { product_ref: productRef(1, 'durante'), product_id: 1, consumption_timing: 'durante', evidence: [{ claim_ref: 'C999' }] },
      { product_ref: productRef(4, 'despues'), product_id: 4, consumption_timing: 'despues', evidence: [{ claim_ref: refOf(choRate.claim_id) }] },
      { product_ref: productRef(4, 'antes'), product_id: 4, consumption_timing: 'antes', evidence: [] },
    ] }, { refs, shortlist });
    expect(accepted).toHaveLength(0);
    expect(discarded.map((d) => d.reason)).toEqual([
      expect.stringMatching(/no elegible/), expect.stringMatching(/claim inexistente/),
      expect.stringMatching(/no pertenece a este producto/), expect.stringMatching(/no cita ningún claim de apoyo/),
    ]);
  });

  it('el respaldo determinista produce recomendaciones válidas y trazables', () => {
    const selected = selectRecommendations(shortlist);
    const { accepted } = validateEvidenceResponse(buildDeterministicResponse({ selected, refs }), { refs, shortlist });
    expect(accepted.length).toBe(selected.length);
    accepted.forEach((a) => expect(a.cited.some((c) => c.role === 'supports')).toBe(true));
  });
});
