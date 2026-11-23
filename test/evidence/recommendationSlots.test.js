// Pruebas unitarias (puras) de la selección por huecos (fase + función) de Evidence RAG: no usan base de datos.
import { describe, it, expect } from 'vitest';
import {
  computeEligibility, selectSlots, normalizeSession, functionOf, MAX_RECOMMENDATIONS, FUNCTIONS,
} from '../../services/evidenceEligibilityService.js';
import { buildEvidenceContext, validateEvidenceResponse } from '../../services/evidencePromptService.js';

// Matriz rol de tipo de producto → nutriente → fases (misma que la migración 014)
const roleMatrix = {
  fueling: { carbohydrate: ['pre', 'during'], caffeine: ['pre', 'during'], sodium: ['pre', 'during'] },
  hydration: { sodium: ['pre', 'during', 'post'], caffeine: ['pre', 'during'] },
  recovery: { protein: ['pre', 'post'], carbohydrate: ['post'] },
};
const ING = { carbohydrate: 1, protein: 2, caffeine: 6, sodium: 7 };
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

const cho3060 = withIngredient('carbohydrate', { source_id: 10, timing_context: ['during'], justified_timings: ['during'],
  dose_value: 30, dose_value_max: 60, dose_unit: 'g/h', conditions: { min_exercise_minutes: 60, max_exercise_minutes: 150 } });
const cho6090 = withIngredient('carbohydrate', { source_id: 11, timing_context: ['during'], justified_timings: ['during'],
  dose_value: 60, dose_value_max: 90, dose_unit: 'g/h', conditions: { min_exercise_minutes: 150 } });
const multiCho = claim({ source_id: 11, formulation_id: 3, formulation_code: 'glucose_fructose', timing_context: ['during'], justified_timings: ['during'] });
const caf36 = withIngredient('caffeine', { source_id: 20, timing_context: ['pre'], justified_timings: ['pre'], dose_value: 3, dose_value_max: 6, dose_unit: 'mg/kg' });
const cafLow = withIngredient('caffeine', { source_id: 21, timing_context: ['pre', 'during'], justified_timings: ['pre', 'during'], dose_value: null, dose_value_max: 3, dose_unit: 'mg/kg' });
const cafMin = withIngredient('caffeine', { source_id: 20, timing_context: ['not_specified'], dose_value: 2, dose_value_max: 3, dose_unit: 'mg/kg', evidence_strength: 'C', timing_evidence_strength: 'not_assessed' });
const protTiming = withIngredient('protein', { source_id: 30, claim_type: 'timing_guideline', timing_context: ['pre', 'post'], justified_timings: ['pre', 'post'] });
const protDose = withIngredient('protein', { source_id: 30, timing_context: ['daily_chronic', 'flexible'], dose_value: 20, dose_value_max: 40, dose_unit: 'g' });
const naContext = withIngredient('sodium', { source_id: 40, claim_type: 'timing_guideline', timing_context: ['pre', 'during', 'post'], justified_timings: ['pre', 'during', 'post'], conditions: { any_of: [{ environment: ['heat'] }, { sweat_loss: ['high'] }] } });
const naDose = withIngredient('sodium', { source_id: 40, timing_context: ['during'], timing_evidence_strength: 'limited', effect_direction: 'mixed', dose_value: 500, dose_value_max: 700, dose_unit: 'mg/L' });
const CLAIMS = [cho3060, cho6090, multiCho, caf36, cafLow, cafMin, protTiming, protDose, naContext, naDose];

const perHour = (id, max, timings = ['during']) => ({ claim_id: 900 + id, source_id: 99, timing_context: timings, dose_unit: 'servings_per_hour', dose_value: 1, dose_value_max: max, frequency: `1–${max} por hora` });
const perDay = (id, timings = ['during']) => ({ claim_id: 900 + id, source_id: 99, timing_context: timings, dose_unit: 'servings_per_day', dose_value: null, dose_value_max: 1, frequency: 'máximo 1 al día' });
const gel = (id, cho, { max = 3, caffeine = 0, formulation = false, verified = true } = {}) => product(id, ['fueling'],
  caffeine ? ['carbohydrate', 'caffeine'] : ['carbohydrate'],
  [ing('carbohydrate', cho, 'g'), ...(caffeine ? [ing('caffeine', caffeine, 'mg')] : [])],
  { instructions: verified ? [perHour(id, max)] : [], formulation_ids: formulation ? [3] : [] });
const rego = product(4, ['recovery'], ['protein', 'carbohydrate'], [ing('protein', 24, 'g'), ing('carbohydrate', 38, 'g')]);
const drink600 = product(14, ['hydration'], ['sodium'], [ing('sodium', 300, 'mg', '500ml drink')]); // 600 mg/L
const nootropics = product(5, ['fueling'], ['carbohydrate', 'caffeine'], [ing('caffeine', 200, 'mg'), ing('carbohydrate', 40, 'g')], { instructions: [perDay(5)] });

const S90 = { durationMin: 90, intensity: 'alto', weather: 'moderado', type: 'resistencia' };
const S180 = { ...S90, durationMin: 180 };
const run = (products, sessionData, profile = { weight: 70 }, claims = CLAIMS) => {
  const session = normalizeSession(sessionData, profile);
  const r = computeEligibility({ products, claims, roleMatrix }, session);
  return { ...r, session, ...selectSlots(r.eligible, { session, caffeineBands: r.caffeineBands }) };
};
const slotKeys = (selected) => selected.flatMap((s) => [s.role, ...s.also_covers].map((fn) => `${s.phase}|${fn}`));

describe('Evidence RAG — huecos fase + función', () => {
  it('la función es neutra: proteína → protein_support antes y después (nunca "recovery")', () => {
    expect(functionOf('protein', 'pre')).toBe('protein_support');
    expect(functionOf('protein', 'post')).toBe('protein_support');
    expect(functionOf('carbohydrate', 'during')).toBe('fueling');
    expect(functionOf('sodium', 'during')).toBe('hydration');
    expect(functionOf('caffeine', 'pre')).toBe('caffeine');
    expect(functionOf('creatine_monohydrate', 'daily_chronic')).toBe('supplementation');
    const r = run([rego], S90);
    expect(r.selected.map((s) => `${s.phase}|${s.role}`).sort()).toEqual(['antes|protein_support', 'despues|protein_support']);
    r.selected.forEach((s) => expect(FUNCTIONS).toContain(s.role));
  });

  it('(1, 2) dos productos fueling en la misma fase → uno principal y el otro como alternativa', () => {
    const r = run([gel(1, 40), gel(13, 22)], S90);
    const fueling = r.selected.filter((s) => s.phase === 'durante' && s.role === 'fueling');
    expect(fueling).toHaveLength(1);
    expect(r.selected.filter((s) => s.phase === 'durante')).toHaveLength(1);
    expect(fueling[0].alternatives.map((a) => a.product_id)).toEqual([fueling[0].product_id === 1 ? 13 : 1]);
    expect(fueling[0].alternatives[0].reason).toBeTruthy();
    expect(fueling[0].alternatives[0].usage_plan.type).toBe('rate');
  });

  it('(3) fueling + hydration pueden coexistir en "durante"', () => {
    const r = run([gel(1, 40), drink600], { ...S90, weather: 'calido' });
    expect(r.selected.filter((s) => s.phase === 'durante').map((s) => s.role).sort()).toEqual(['fueling', 'hydration']);
    expect(new Set(slotKeys(r.selected)).size).toBe(slotKeys(r.selected).length);
  });

  it('(4) protein_support + hydration pueden coexistir "después" si la evidencia y el contexto lo permiten', () => {
    const r = run([rego, drink600], { ...S90, weather: 'calido' });
    const after = r.selected.filter((s) => s.phase === 'despues').map((s) => s.role).sort();
    expect(after).toEqual(['hydration', 'protein_support']);
    // Sin calor ni sudoración alta, el claim de sodio no se cumple: solo proteína
    const normal = run([rego, drink600], S90);
    expect(normal.selected.filter((s) => s.phase === 'despues').map((s) => s.role)).toEqual(['protein_support']);
  });

  it('(5, 6) el mismo producto se repite varias veces por hora; no se obliga a cambiar de gel', () => {
    const r = run([gel(25, 40, { formulation: true }), gel(1, 40), gel(13, 22)], S180);
    const fueling = r.selected.filter((s) => s.role === 'fueling');
    expect(fueling).toHaveLength(1);
    const plan = fueling[0].usage_plan;
    expect(plan.repeat_same_product).toBe(true);
    expect(plan.servings_per_hour_min).toBeCloseTo(1.5, 1);
    expect(plan.servings_per_hour_max).toBeCloseTo(2.25, 0);
    expect(plan.interval_minutes_max).toBe(40);
    expect(plan.interval_minutes_min).toBeGreaterThanOrEqual(26);
    expect(plan.servings_total_min).toBeCloseTo(4.5, 1);
    expect(fueling[0].target).toMatchObject({ nutrient: 'carbohydrate', min: 60, max: 90, unit: 'g/h' });
  });

  it('(7) porciones/h = objetivo ÷ gramos por porción (40, 22 y 30 g con 60 g/h)', () => {
    const lo = (cho) => run([gel(1, cho, { formulation: true })], S180).selected[0].usage_plan.servings_per_hour_min;
    expect(lo(40)).toBeCloseTo(1.5, 5);
    expect(lo(22)).toBeCloseTo(2.7, 5);
    expect(lo(30)).toBeCloseTo(2, 5);
  });

  it('(8) cadence_verified respeta el máximo de la ficha oficial', () => {
    const r = run([gel(1, 40, { max: 2, formulation: true })], S180);
    expect(r.selected[0].cadence_status ?? r.selected[0].status).toBe('cadence_verified');
    expect(r.selected[0].usage_plan.servings_per_hour_max).toBe(2);
  });

  it('(9) cadence_unverified no permite varias porciones por hora: no compite como fueling por tasa', () => {
    const r = run([gel(2, 40, { verified: false }), gel(1, 40)], S90);
    expect(r.rejected.some((x) => x.product_id === 2 && /cadence_unverified/.test(x.reason))).toBe(true);
    const fueling = r.selected.find((s) => s.role === 'fueling');
    expect(fueling.product_id).toBe(1);
    expect(fueling.alternatives.map((a) => a.product_id)).not.toContain(2);
  });

  it('(10) cafeína acumulada: cuenta TODAS las porciones; un gel con CHO y cafeína es UNA recomendación', () => {
    const r = run([gel(6, 22, { caffeine: 75 })], S90);
    expect(r.selected).toHaveLength(1);
    const rec = r.selected[0];
    expect(rec.role).toBe('fueling');
    expect(rec.also_covers).toEqual(['caffeine']);
    // Sus 22 g cuentan enteros para el objetivo de CHO: 1.4–2.7 geles/h. La cafeína de TODAS las porciones
    // (1.4 × 1.5 h × 75 mg = 2.25 mg/kg) ya alcanza la banda "durante" (2–3 mg/kg del claim), así que cubre la
    // cafeína; el extremo alto (2.7/h → 4.34 mg/kg) supera el máximo del claim aplicable y se limita a 1.8 geles/h.
    expect(rec.usage_plan.servings_per_hour_min).toBe(1.4);
    expect(rec.usage_plan.servings_per_hour_max).toBe(1.8);
    expect(rec.usage_plan.caffeine.mg_min).toBe(Math.round(1.4 * 1.5 * 75));
    expect(rec.usage_plan.caffeine.mg_max).toBe(Math.round(1.8 * 1.5 * 75));
    expect(r.caffeine.mg_per_kg_max).toBeLessThanOrEqual(3);
    expect(rec.warnings.some((x) => /limitadas/.test(x))).toBe(true);
  });

  it('(11) no añade un segundo producto cafeinado si la cafeína ya está cubierta', () => {
    const r = run([gel(6, 22, { caffeine: 75 }), nootropics], S90);
    expect(r.selected.filter((s) => s.usage_plan.caffeine)).toHaveLength(1);
    expect(r.selected.map((s) => s.product_id)).not.toContain(5);
    expect(r.decisions.some((d) => /cafeína ya cubierta/.test(d.reason)) || slotKeys(r.selected).includes('durante|caffeine')).toBe(true);
  });

  it('(11) un producto de cafeína con CHO cuenta en el objetivo de carbohidrato y sustituye porciones (no además)', () => {
    const r = run([gel(1, 40), nootropics], S90);
    const fuel = r.selected.find((s) => s.role === 'fueling');
    const caf = r.selected.find((s) => s.role === 'caffeine');
    expect(caf.product_id).toBe(5);
    expect(caf.usage_plan.replaces).toMatchObject({ product_id: 1, servings: 1, carbohydrate_g: 40 });
    expect(fuel.usage_plan.includes).toEqual([expect.objectContaining({ product_id: 5, carbohydrate_g: 40, replaces_servings: 1 })]);
  });

  it('un gel cafeinado cuyo plan necesario excede el máximo del claim se descarta y no aparece como alternativa', () => {
    const r = run([gel(7, 40, { caffeine: 250, formulation: true }), gel(1, 40, { formulation: true })], S180);
    expect(r.selected.map((s) => s.product_id)).toEqual([1]);
    expect(r.selected[0].alternatives.map((a) => a.product_id)).not.toContain(7);
    const d = r.decisions.find((x) => x.product_id === 7);
    expect(d.excluded).toBe(true);
    expect(d.reason).toMatch(/mg\/kg/);
    expect(d.reason).toMatch(/como máximo 3 mg\/kg/); // el claim aplicable "durante", no el de "antes"
    expect(r.decisions.filter((x) => x.product_id === 7).every((x) => x.excluded)).toBe(true);
  });

  it('si solo el extremo alto del plan excede la banda del claim, se limitan las porciones/h (sin frontera inventada)', () => {
    const r = run([gel(8, 40, { caffeine: 35, formulation: true })], S180);
    const rec = r.selected[0];
    // 1.5–2.3 geles/h × 3 h × 35 mg = 2.25–3.45 mg/kg; el claim "durante" admite hasta 3 mg/kg → máx. 3·70/(3·35) = 2/h
    expect(rec.usage_plan.servings_per_hour_min).toBe(1.5);
    expect(rec.usage_plan.servings_per_hour_max).toBe(2);
    expect(r.caffeine.mg_per_kg_max).toBeLessThanOrEqual(3);
    expect(r.caffeine.band).toEqual({ min: 2, max: 3, unit: 'mg/kg' });
  });

  it('(12) no fuerza fases: sin evidencia para antes/después, solo devuelve "durante"', () => {
    const r = run([gel(1, 40)], S90);
    expect(r.selected.map((s) => s.phase)).toEqual(['durante']);
  });

  it('(13) el máximo se aplica a las recomendaciones principales, no a las alternativas', () => {
    const products = [gel(1, 40), gel(13, 22), rego, drink600, product(15, ['hydration'], ['sodium'], [ing('sodium', 280, 'mg', '500ml drink')])];
    const all = run(products, { ...S90, weather: 'calido' });
    expect(all.selected.length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS);
    expect(all.selected.some((s) => s.alternatives.length > 0)).toBe(true);
    const session = normalizeSession({ ...S90, weather: 'calido' }, { weight: 70 });
    const capped = selectSlots(all.eligible, { session, caffeineBands: all.caffeineBands, max: 2 });
    expect(capped.selected).toHaveLength(2);
    expect(capped.selected.reduce((n, s) => n + s.alternatives.length, 0)).toBeGreaterThan(0);
    expect(capped.decisions.some((d) => /máximo de 2/.test(d.reason))).toBe(true);
  });
});

describe('Evidence RAG — Gemini no elige el producto principal', () => {
  it('rechaza que el LLM sustituya el principal por una alternativa', () => {
    const r = run([gel(1, 40), gel(13, 22)], S90);
    const shortlist = r.selected;
    const { refs } = buildEvidenceContext({ profile: {}, session: r.session, shortlist, chunksByClaim: new Map() });
    const primary = shortlist[0];
    const alt = primary.alternatives[0].product_id;
    const claimRef = [...refs.claims.values()].find((c) => c.claim.claim_id === cho3060.claim_id).ref;
    const { accepted, discarded } = validateEvidenceResponse({ recommendations: [
      { product_id: alt, consumption_timing: 'durante', evidence: [{ claim_ref: claimRef, role: 'supports' }] },
    ] }, { refs, shortlist });
    expect(accepted).toHaveLength(0);
    expect(discarded[0].reason).toMatch(/no elegible/);
  });
});
