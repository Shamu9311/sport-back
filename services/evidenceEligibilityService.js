// services/evidenceEligibilityService.js — Elegibilidad producto × fase basada en evidencia (Evidence RAG).
//
// Orden de decisión (diseño aprobado):
//   claim científico/guía revisado → habilita nutriente + timing + condiciones
//   → el rol funcional del tipo de producto es compatible (clasificación versionada; restringe, nunca habilita)
//   → el producto contiene una cantidad útil del nutriente (según la dosis del claim)
//   → la ficha oficial REVISADA del fabricante confirma o restringe la forma/frecuencia (nunca demuestra eficacia)
//   → ranking.
//
// Cadencia:
//   cadence_verified   = existe una instrucción oficial revisada con frecuencia numérica para esa fase.
//   cadence_unverified = no la hay. Solo se admite UNA porción que cumpla por sí sola la dosis; nunca tasas
//                        por hora, porciones múltiples (tampoco de cafeína) ni daily_chronic.
import pool from '../config/db.js';

export const TIMING_TO_PHASE = { pre: 'antes', during: 'durante', post: 'despues', daily_chronic: 'diario' };
export const PHASE_TO_TIMING = Object.fromEntries(Object.entries(TIMING_TO_PHASE).map(([k, v]) => [v, k]));
export const PHASE_ORDER = ['antes', 'durante', 'despues', 'diario'];

export const MAX_RECOMMENDATIONS = 5;

/** Pesos del ranking (documentados en data/evidence/README.md). */
export const LEVEL_WEIGHT = { A: 1.0, B: 0.85, C: 0.6, D: 0.3 };
export const RELATION_WEIGHT = { direct_product: 1.0, formulation: 0.9, ingredient: 0.75 };
export const TIMING_STRENGTH_WEIGHT = { strong: 1.0, moderate: 0.8 };
export const EFFECT_WEIGHT = { positive: 1.0, mixed: 0.5 };
export const CADENCE_WEIGHT = { cadence_verified: 1.0, cadence_unverified: 0.6 };
const CONTEXTUAL_TIER_WEIGHT = 0.7;
const UNSTRUCTURED_CONDITIONS_WEIGHT = 0.85;
const CAVEAT_EFFECTS = ['neutral', 'negative', 'insufficient'];

/**
 * Por encima de 60 g/h los claims AIS de ultra-resistencia indican múltiples carbohidratos transportables
 * ("ais-gel-carb-ultra": "múltiples carbohidratos transportables cuando >60 g/h"). Un producto sin formulación
 * declarada de varios carbohidratos no se usa para objetivos por encima de este valor.
 */
export const SINGLE_SOURCE_CHO_MAX_G_PER_H = 60;

// ------------------------------------------------------------------ Normalización de sesión y perfil
const INTENSITY = { bajo: 'low', medio: 'moderate', alto: 'high', 'muy alto': 'very_high' };
const WEATHER = { calido: 'heat', caliente: 'heat', humedo: 'humid', frio: 'cold', fresco: 'temperate', moderado: 'temperate' };
const SWEAT = { bajo: 'low', medio: 'moderate', alto: 'high' };

export function normalizeSession(trainingData = {}, profile = {}) {
  const duration = Number(trainingData.durationMin ?? trainingData.duration_min ?? trainingData.duration);
  const weight = Number(profile.weight);
  return {
    durationMin: Number.isFinite(duration) && duration > 0 ? duration : null,
    intensity: INTENSITY[String(trainingData.intensity || '').toLowerCase()] || null,
    environment: WEATHER[String(trainingData.weather || '').toLowerCase()] || null,
    type: trainingData.type || null,
    sport: trainingData.sport_type || null,
    weightKg: Number.isFinite(weight) && weight > 0 ? weight : null,
    caffeineTolerance: profile.caffeine_tolerance ? String(profile.caffeine_tolerance).toLowerCase() : null,
    // Pérdidas de sudor declaradas en el perfil (sweat_level). No existe un dato de "salty sweat" en el perfil.
    sweatLoss: SWEAT[String(profile.sweat_level || '').toLowerCase()] || null,
  };
}

/** Comprueba un conjunto de condiciones (o un disparador de any_of). Devuelve los motivos de incumplimiento. */
function unmetConditions(c, session) {
  const reasons = [];
  if (c.min_exercise_minutes != null || c.max_exercise_minutes != null) {
    if (session.durationMin == null) reasons.push('duración de la sesión desconocida');
    else if (c.min_exercise_minutes != null && session.durationMin < c.min_exercise_minutes) reasons.push(`requiere ≥${c.min_exercise_minutes} min`);
    else if (c.max_exercise_minutes != null && session.durationMin > c.max_exercise_minutes) reasons.push(`aplica hasta ${c.max_exercise_minutes} min`);
  }
  if (Array.isArray(c.intensity) && c.intensity.length
      && !(c.intensity.includes(session.intensity) || (session.intensity === 'very_high' && c.intensity.includes('high')))) {
    reasons.push(`requiere intensidad ${c.intensity.join('/')}`);
  }
  if (Array.isArray(c.environment) && c.environment.length && !c.environment.includes(session.environment)) {
    reasons.push(`requiere ambiente ${c.environment.join('/')}`);
  }
  if (Array.isArray(c.sweat_loss) && c.sweat_loss.length && !c.sweat_loss.includes(session.sweatLoss)) {
    reasons.push(`requiere sudoración ${c.sweat_loss.join('/')}`);
  }
  return reasons;
}

/** ¿Se cumplen las condiciones de aplicabilidad del claim en esta sesión? (any_of: basta un disparador) */
export function conditionsMatch(claim, session) {
  const c = claim.conditions || {};
  const min = c.min_exercise_minutes ?? claim.exercise_duration_min_minutes ?? null;
  const max = c.max_exercise_minutes ?? claim.exercise_duration_max_minutes ?? null;
  const reasons = [];
  let structured = false;
  if (Array.isArray(c.any_of) && c.any_of.length) {
    structured = true;
    const results = c.any_of.map((trigger) => unmetConditions(trigger, session));
    if (!results.some((r) => r.length === 0)) reasons.push(`ningún disparador se cumple (${results.map((r) => r.join(', ')).join(' | ')})`);
  }
  if (Array.isArray(c.sweat_loss) && c.sweat_loss.length) {
    structured = true;
    reasons.push(...unmetConditions({ sweat_loss: c.sweat_loss }, session));
  }
  if (min != null || max != null) {
    structured = true;
    if (session.durationMin == null) reasons.push('duración de la sesión desconocida');
    else if (min != null && session.durationMin < min) reasons.push(`requiere ≥${min} min`);
    else if (max != null && session.durationMin > max) reasons.push(`aplica hasta ${max} min`);
  }
  if (Array.isArray(c.intensity) && c.intensity.length) {
    structured = true;
    const ok = c.intensity.includes(session.intensity) || (session.intensity === 'very_high' && c.intensity.includes('high'));
    if (!ok) reasons.push(`requiere intensidad ${c.intensity.join('/')}`);
  }
  if (Array.isArray(c.environment) && c.environment.length) {
    structured = true;
    if (!c.environment.includes(session.environment)) reasons.push(`requiere ambiente ${c.environment.join('/')}`);
  }
  return { ok: reasons.length === 0, structured, reasons };
}

// ------------------------------------------------------------------ Dosis
export function unitKind(unit) {
  if (!unit) return null;
  if (['g/h', 'g/min'].includes(unit)) return 'rate';
  if (unit === 'g/kg/h') return 'rate_per_kg';
  if (unit === 'mg/kg') return 'per_kg';
  if (unit === 'mg/L') return 'concentration';
  if (['g', 'mg', 'ug'].includes(unit)) return 'per_intake';
  if (['g/day', 'g/kg/day'].includes(unit)) return 'daily';
  return 'other';
}

const toPerHour = (value, unit) => (value == null ? null : unit === 'g/min' ? value * 60 : value);
const sameSubject = (a, b) =>
  (a.ingredient_id != null && a.ingredient_id === b.ingredient_id) ||
  (a.formulation_id != null && a.formulation_id === b.formulation_id);

/**
 * Dosis que exige el claim, en la unidad del claim. Si el claim no declara dosis, hereda la del claim con dosis
 * del mismo sujeto y la misma fuente (las tasas por hora solo si comparten momento). Si solo declara un máximo,
 * el mínimo se toma del claim revisado del mismo ingrediente y unidad con el menor valor declarado (preferente-
 * mente de la misma fuente); esa referencia marca la banda como "contextual".
 */
export function resolveDose(claim, timing, claims) {
  const dosed = (c) => c.dose_unit && unitKind(c.dose_unit) !== 'other' && (c.dose_value != null || c.dose_value_max != null);
  let base = claim;
  const refs = [];
  if (!dosed(claim)) {
    // Solo dosis compatibles con el momento: las tasas por hora si comparten momento; las diarias solo para
    // daily_chronic. Preferencia: dosis por toma > por kg > concentración > tasa; luego mayor fuerza del claim.
    const KIND_PRIORITY = { per_intake: 0, per_kg: 1, concentration: 2, rate: 3, daily: 4 };
    const candidates = claims.filter((c) => {
      if (c.claim_id === claim.claim_id || c.source_id !== claim.source_id || !sameSubject(c, claim)) return false;
      if (!dosed(c) || c.dose_value == null) return false;
      const kind = unitKind(c.dose_unit);
      if (kind === 'rate' || kind === 'rate_per_kg') return (c.timing_context || []).includes(timing);
      if (kind === 'daily') return timing === 'daily_chronic';
      return true;
    });
    if (!candidates.length) return null;
    const strength = (c) => LEVEL_WEIGHT[c.evidence_strength] ?? 1;
    base = candidates.sort((a, b) => (KIND_PRIORITY[unitKind(a.dose_unit)] ?? 9) - (KIND_PRIORITY[unitKind(b.dose_unit)] ?? 9)
      || strength(b) - strength(a) || Number(a.dose_value) - Number(b.dose_value))[0];
    refs.push({ claim: base, reason: 'dosis heredada de la misma fuente' });
  }
  const unit = base.dose_unit;
  let lo = base.dose_value != null ? Number(base.dose_value) : null;
  const hi = base.dose_value_max != null ? Number(base.dose_value_max) : null;
  let tier = ['C', 'D'].includes(base.evidence_strength) ? 'contextual' : 'principal';
  if (lo == null && hi != null) {
    const floors = claims.filter((c) => c.claim_id !== base.claim_id && c.ingredient_id != null
      && c.ingredient_id === base.ingredient_id && c.dose_unit === unit && c.dose_value != null && Number(c.dose_value) < hi);
    if (!floors.length) return null;
    const sameSource = floors.filter((c) => c.source_id === base.source_id);
    const floor = (sameSource.length ? sameSource : floors).sort((a, b) => Number(a.dose_value) - Number(b.dose_value))[0];
    lo = Number(floor.dose_value);
    refs.push({ claim: floor, reason: 'mínimo tomado de otro claim revisado' });
    if (floor.source_id !== base.source_id || ['C', 'D'].includes(floor.evidence_strength)) tier = 'contextual';
  }
  if (lo == null) return null;
  return {
    unit: unit === 'g/min' ? 'g/h' : unit,
    kind: unitKind(unit),
    lo: toPerHour(lo, unit),
    hi: toPerHour(hi, unit),
    tier,
    refs,
  };
}

// ------------------------------------------------------------------ Producto
/** Cantidad por porción (per_serving o per_unit). Sin cantidad o con otra base, el nutriente no se puede evaluar. */
export function servingAmount(product, code) {
  const rows = (product.ingredients || []).filter((i) => i.code === code && i.amount != null);
  const row = rows.find((i) => i.basis === 'per_serving') || rows.find((i) => i.basis === 'per_unit');
  return row ? { amount: Number(row.amount), unit: row.unit, basis: row.basis, serving: row.serving_description } : null;
}

/** Volumen de bebida preparada declarado en la porción ("500ml drink", "50g en 500ml"); null si no es una bebida. */
export function drinkVolumeMl(serving) {
  const s = String(serving || '');
  const m = s.match(/(\d+)\s*ml\s*drink/i) || s.match(/en\s*(\d+)\s*ml/i);
  return m ? Number(m[1]) : null;
}

/** El rol funcional restringe qué nutrientes y fases tiene sentido evaluar (no habilita nada). */
export function roleAllows(product, nutrient, timing, roleMatrix) {
  if (!product.roles || product.roles.includes('no_fueling')) return false;
  if (!(product.nutrients || []).includes(nutrient)) return false;
  return product.roles.some((r) => (roleMatrix[r]?.[nutrient] || []).includes(timing));
}

/** Instrucción oficial revisada para esa fase y su cadencia numérica (si la declara). */
export function officialInstruction(product, timing) {
  const all = product.instructions || [];
  const forTiming = all.find((i) => (i.timing_context || []).includes(timing));
  const contradicted = all.length > 0 && !forTiming;
  let cadence = null;
  if (forTiming && ['servings_per_hour', 'servings_per_day'].includes(forTiming.dose_unit) && forTiming.dose_value_max != null) {
    cadence = { per: forTiming.dose_unit === 'servings_per_hour' ? 'hour' : 'day', max: Number(forTiming.dose_value_max),
      min: forTiming.dose_value != null ? Number(forTiming.dose_value) : null };
  }
  return { instruction: forTiming || null, contradicted, cadence };
}

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** Plan de consumo para una dosis concreta, o { viable: false, reason }. */
export const NUTRIENT_LABEL = { carbohydrate: 'carbohidrato', protein: 'proteína', sodium: 'sodio', caffeine: 'cafeína', creatine_monohydrate: 'creatina' };

export function computePlan({ dose, amount, session, status, cadence, nutrient }) {
  const label = NUTRIENT_LABEL[nutrient] || nutrient || 'nutriente';
  const unitLabel = amount.unit || '';
  const requiresVerified = (n) => {
    if (status !== 'cadence_verified' || !cadence) return 'requiere cadencia oficial verificada';
    if (n > cadence.max) return `la ficha oficial permite como máximo ${cadence.max} porción(es) por ${cadence.per === 'hour' ? 'hora' : 'día'}`;
    return null;
  };

  if (dose.kind === 'rate') {
    // Tasa por hora: siempre exige cadencia verificada por hora
    if (status !== 'cadence_verified' || cadence?.per !== 'hour') {
      return { viable: false, reason: 'tasa por hora sin cadencia oficial verificada (cadence_unverified)' };
    }
    const hiTarget = dose.hi ?? dose.lo;
    const minS = dose.lo / amount.amount;
    const maxS = hiTarget / amount.amount;
    if (minS > cadence.max) return { viable: false, reason: `necesita ${round(minS)} porciones/h y la ficha permite ${cadence.max}` };
    const maxAllowed = Math.min(maxS, cadence.max);
    const gLo = round(minS * amount.amount, 0);
    const gHi = round(maxAllowed * amount.amount, 0);
    return {
      viable: true,
      type: 'rate',
      servings_per_hour: [round(minS), round(maxAllowed)],
      target_g_per_hour: [dose.lo, hiTarget],
      achievable_g_per_hour: [gLo, gHi],
      interval_minutes: Math.round(60 / Math.max(minS, 1e-9)),
      quantity: `${round(minS)}–${round(maxAllowed)} porciones/h (≈${gLo}–${gHi} g/h de ${label})`,
    };
  }

  if (dose.kind === 'per_intake' || dose.kind === 'daily') {
    if (dose.kind === 'daily' && status !== 'cadence_verified') return { viable: false, reason: 'uso diario sin cadencia oficial verificada' };
    const n = Math.ceil(dose.lo / amount.amount - 1e-9);
    if (n > 1) {
      const why = requiresVerified(n);
      if (why) return { viable: false, reason: `una porción (${amount.amount} ${unitLabel}) no alcanza ${dose.lo} ${dose.unit}; ${why}` };
    }
    return { viable: true, type: 'servings', servings: n, quantity: `${n} porción${n > 1 ? 'es' : ''} (${round(n * amount.amount)} ${unitLabel})` };
  }

  if (dose.kind === 'per_kg') {
    if (!session.weightKg) return { viable: false, reason: 'peso del usuario desconocido' };
    const perServing = amount.amount / session.weightKg;
    const n = Math.ceil(dose.lo / perServing - 1e-9);
    if (n > 1) {
      const why = requiresVerified(n);
      if (why) return { viable: false, reason: `una porción aporta ${round(perServing, 2)} mg/kg (< ${dose.lo}); ${why}` };
    }
    const mgkg = round((n * amount.amount) / session.weightKg, 2);
    const warnings = dose.hi != null && mgkg > dose.hi ? [`${mgkg} mg/kg supera el rango objetivo (${dose.lo}–${dose.hi} mg/kg)`] : [];
    return { viable: true, type: 'servings', servings: n, dose_mg_per_kg: mgkg, warnings,
      quantity: `${n} porción${n > 1 ? 'es' : ''} (${round(n * amount.amount, 0)} mg ≈ ${mgkg} mg/kg)` };
  }

  if (dose.kind === 'concentration') {
    const ml = drinkVolumeMl(amount.serving);
    if (!ml) return { viable: false, reason: 'la porción no declara volumen de bebida' };
    const mgPerL = round((amount.amount / ml) * 1000, 0);
    if (mgPerL < dose.lo) return { viable: false, reason: `${mgPerL} mg/L < ${dose.lo} mg/L` };
    // Por encima del máximo del claim, ese claim no respalda la concentración. Diluir solo sería válido si la
    // ficha oficial revisada declarase un volumen de preparación alternativo (el contrato aún no lo estructura).
    if (dose.hi != null && mgPerL > dose.hi) {
      return { viable: false, reason: `${mgPerL} mg/L supera el rango respaldado (${dose.lo}–${dose.hi} mg/L); requiere otro claim revisado o una preparación oficial que lo diluya` };
    }
    return { viable: true, type: 'servings', servings: 1, concentration_mg_per_l: mgPerL,
      target_mg_per_l: [dose.lo, dose.hi],
      quantity: `1 porción (${ml} ml, ≈${mgPerL} mg/L de ${label}; rango respaldado ${dose.lo}–${dose.hi ?? '…'} mg/L)` };
  }

  return { viable: false, reason: `unidad de dosis no evaluable (${dose.unit})` };
}

// ------------------------------------------------------------------ Elegibilidad
function claimWeight(claim, relation, cond, tier) {
  const level = LEVEL_WEIGHT[claim.source_evidence_level] ?? 0.5;
  const own = claim.evidence_strength ? LEVEL_WEIGHT[claim.evidence_strength] : 1;
  return Math.min(level, own ?? 1)
    * (RELATION_WEIGHT[relation] ?? 0.75)
    * (TIMING_STRENGTH_WEIGHT[claim.timing_evidence_strength] ?? 0)
    * (EFFECT_WEIGHT[claim.effect_direction] ?? 0)
    * (cond.structured ? 1 : UNSTRUCTURED_CONDITIONS_WEIGHT)
    * (tier === 'contextual' ? CONTEXTUAL_TIER_WEIGHT : 1);
}

/**
 * Calcula los pares (producto, fase) elegibles. Función pura: recibe los datos ya cargados.
 * @returns {{ eligible: object[], rejected: object[] }}
 */
export function computeEligibility({ products, claims, roleMatrix }, session, { similarity = new Map(), positiveProductIds = [] } = {}) {
  const eligible = [];
  const rejected = [];
  const enabling = claims.filter((c) => (c.justified_timings || []).length > 0);

  for (const product of products) {
    if (!product.roles) { rejected.push({ product_id: product.product_id, reason: 'tipo de producto sin clasificación funcional' }); continue; }
    if (product.roles.includes('no_fueling')) { rejected.push({ product_id: product.product_id, reason: 'rol no_fueling' }); continue; }

    const caffeine = servingAmount(product, 'caffeine');
    if (caffeine?.amount > 0 && session.caffeineTolerance === 'no') {
      rejected.push({ product_id: product.product_id, reason: 'contiene cafeína y la tolerancia es "no"' }); continue;
    }
    if (caffeine?.amount > 50 && session.caffeineTolerance === 'bajo') {
      rejected.push({ product_id: product.product_id, reason: 'cafeína > 50 mg con tolerancia baja' }); continue;
    }

    const groups = new Map(); // `${timing}|${nutrient}` → candidatos
    for (const claim of enabling) {
      let nutrient;
      let relation;
      if (claim.formulation_id != null) {
        if (!(product.formulation_ids || []).includes(claim.formulation_id)) continue;
        nutrient = 'carbohydrate';
        relation = 'formulation';
      } else if (claim.ingredient_id != null) {
        nutrient = claim.ingredient_code;
        relation = 'ingredient';
      } else continue;

      for (const timing of claim.justified_timings) {
        const key = `${timing}|${nutrient}`;
        const reject = (reason) => rejected.push({ product_id: product.product_id, timing, nutrient, claim_id: claim.claim_id, reason });
        if (timing === 'daily_chronic' && claim.ingredient_category === 'macronutrient') { reject('daily_chronic no se deriva de guías de ingesta total de macronutrientes'); continue; }
        if (!roleAllows(product, nutrient, timing, roleMatrix)) { reject('rol funcional no compatible'); continue; }
        const cond = conditionsMatch(claim, session);
        if (!cond.ok) { reject(`condiciones del claim: ${cond.reasons.join('; ')}`); continue; }
        const amount = servingAmount(product, nutrient);
        if (!amount || !(amount.amount > 0)) { reject('cantidad por porción no declarada'); continue; }
        const { instruction, contradicted, cadence } = officialInstruction(product, timing);
        if (contradicted) { reject('la ficha oficial revisada no contempla este uso'); continue; }
        const status = instruction && cadence ? 'cadence_verified' : 'cadence_unverified';

        if (relation === 'formulation') {
          // La formulación no fija el objetivo de CHO: respalda el uso del producto cuando ya es elegible por CHO.
          if (!groups.has(key)) groups.set(key, { product, timing, nutrient, amount, status, instruction, cadence, viable: [], formulation: [] });
          groups.get(key).formulation.push({ claim, relation, cond });
          continue;
        }
        const dose = resolveDose(claim, timing, claims);
        if (!dose) { reject('el claim no permite derivar una dosis'); continue; }
        if (dose.kind === 'rate' && dose.hi != null && dose.hi > SINGLE_SOURCE_CHO_MAX_G_PER_H && nutrient === 'carbohydrate'
            && !(product.formulation_ids || []).length) {
          dose.hi = SINGLE_SOURCE_CHO_MAX_G_PER_H;
        }
        if (!groups.has(key)) groups.set(key, { product, timing, nutrient, amount, status, instruction, cadence, viable: [], formulation: [] });
        groups.get(key).viable.push({ claim, relation, cond, dose });
      }
    }

    for (const g of groups.values()) {
      const doseClaims = g.viable;
      if (!doseClaims.length) continue;
      // Tasas: se combina el rango de todos los claims aplicables (p. ej. 30–60 g/h + hasta 90 g/h)
      const rate = doseClaims.filter((v) => v.dose.kind === 'rate');
      let plan;
      let used;
      let dose;
      if (rate.length) {
        const lo = Math.min(...rate.map((v) => v.dose.lo));
        const hi = Math.max(...rate.map((v) => v.dose.hi ?? v.dose.lo));
        dose = { kind: 'rate', unit: 'g/h', lo, hi };
        plan = computePlan({ dose, amount: g.amount, session, status: g.status, cadence: g.cadence, nutrient: g.nutrient });
        used = rate;
      } else {
        const tried = doseClaims.map((v) => ({ v, plan: computePlan({ dose: v.dose, amount: g.amount, session, status: g.status, cadence: g.cadence, nutrient: g.nutrient }) }));
        const ok = tried.filter((t) => t.plan.viable);
        if (!ok.length) {
          tried.forEach((t) => rejected.push({ product_id: g.product.product_id, timing: g.timing, nutrient: g.nutrient, claim_id: t.v.claim.claim_id, reason: t.plan.reason }));
          continue;
        }
        // Se prefiere la banda principal; la contextual solo si no hay otra
        const principal = ok.filter((t) => t.v.dose.tier === 'principal');
        const chosen = principal.length ? principal : ok;
        plan = chosen[0].plan;
        dose = chosen[0].v.dose;
        used = chosen.map((t) => t.v);
      }
      if (!plan.viable) {
        rejected.push({ product_id: g.product.product_id, timing: g.timing, nutrient: g.nutrient, reason: plan.reason });
        continue;
      }

      const supporting = [...used, ...g.formulation].map((v) => {
        const tier = v.dose?.tier || 'principal';
        const w = claimWeight(v.claim, v.relation, v.cond, tier);
        const sim = similarity.get(v.claim.claim_id) ?? 0;
        return { claim: v.claim, relation: v.relation, tier, weight: w, similarity: sim, score: w * (0.5 + 0.5 * sim), structured: !!v.cond?.structured };
      }).sort((a, b) => b.score - a.score);

      const doseRefs = used.flatMap((v) => v.dose?.refs || []).map((r) => r.claim);
      const subjectMatch = (c) => (c.ingredient_id != null && c.ingredient_code === g.nutrient)
        || (c.formulation_id != null && (g.product.formulation_ids || []).includes(c.formulation_id));
      const caveats = claims.filter((c) => CAVEAT_EFFECTS.includes(c.effect_direction) && subjectMatch(c)
        && ((c.timing_context || []).includes(g.timing)))
        .map((c) => ({ claim: c, weight: (LEVEL_WEIGHT[c.source_evidence_level] ?? 0.5) * (c.formulation_id ? 0.9 : 0.75) }));

      const sources = new Set(supporting.map((s) => s.claim.source_id));
      const best = supporting[0].score;
      const caveatPenalty = caveats.length ? 0.5 * Math.max(...caveats.map((c) => c.weight)) : 0;
      let score = best + Math.min(0.2, 0.1 * (sources.size - 1)) - caveatPenalty;
      if (score <= 0) {
        rejected.push({ product_id: g.product.product_id, timing: g.timing, nutrient: g.nutrient, reason: 'la evidencia neutral/insuficiente pesa igual o más que el apoyo' });
        continue;
      }
      score *= CADENCE_WEIGHT[g.status];
      if (positiveProductIds.includes(g.product.product_id)) score += 0.05;
      const tier = used.some((v) => v.dose?.tier === 'principal') ? 'principal' : 'contextual';

      eligible.push({
        product_id: g.product.product_id,
        product_name: g.product.name,
        type_name: g.product.type_name,
        roles: g.product.roles,
        timing: g.timing,
        phase: TIMING_TO_PHASE[g.timing],
        nutrient: g.nutrient,
        amount: g.amount,
        status: g.status,
        tier,
        dose: { kind: dose.kind, unit: dose.unit, lo: dose.lo, hi: dose.hi ?? null },
        plan,
        instruction: g.instruction,
        supporting,
        doseRefs,
        caveats,
        warnings: plan.warnings || [],
        positive: positiveProductIds.includes(g.product.product_id),
        caffeine_mg_per_serving: caffeineMgPerServing(g.product),
        carbohydrate_per_serving: servingAmount(g.product, 'carbohydrate')?.amount ?? 0,
        score: Math.round(score * 10000) / 10000,
      });
    }
  }
  eligible.sort((a, b) => b.score - a.score || a.product_id - b.product_id);
  return { eligible, rejected, caffeineBands: caffeineBandsFor(claims, session) };
}

// ------------------------------------------------------------------ Huecos: fase + función
/**
 * Función neutra de un par (nutriente, momento). No es el rol del tipo de producto: es el objetivo nutricional que
 * cubre la recomendación. La UI la traduce según la fase (p. ej. después + protein_support → "Recuperación proteica").
 * El orden de la lista es el orden de llenado: la cafeína va al final para conocer la cafeína ya acumulada.
 */
export const FUNCTIONS = ['fueling', 'protein_support', 'hydration', 'supplementation', 'caffeine'];
const FUNCTION_BY_NUTRIENT = { carbohydrate: 'fueling', protein: 'protein_support', sodium: 'hydration', caffeine: 'caffeine' };
export function functionOf(nutrient, timing) {
  if (timing === 'daily_chronic') return 'supplementation';
  return FUNCTION_BY_NUTRIENT[nutrient] || 'supplementation';
}
export const MAX_ALTERNATIVES = 2;

/** Cafeína declarada por porción, en mg (0 si no tiene). */
export function caffeineMgPerServing(product) {
  const a = servingAmount(product, 'caffeine');
  if (!a || !(a.amount > 0)) return 0;
  return a.unit === 'g' ? a.amount * 1000 : a.amount;
}

/** Cafeína que aporta un plan durante toda la sesión: todas las porciones, no solo una. */
export function caffeineOfPlan(mgPerServing, plan, session) {
  if (!mgPerServing) return { min: 0, max: 0 };
  if (plan.type === 'rate') {
    const hours = session?.durationMin ? session.durationMin / 60 : 1;
    return { min: plan.servings_per_hour[0] * hours * mgPerServing, max: plan.servings_per_hour[1] * hours * mgPerServing };
  }
  const n = plan.servings ?? 1;
  return { min: n * mgPerServing, max: n * mgPerServing };
}

/**
 * Bandas de cafeína (mg/kg) de los claims revisados aplicables a la sesión. Son las únicas fronteras que se usan:
 * el mínimo con respaldo (cualquier banda) y el máximo que declara algún claim. Sin bandas no hay frontera.
 */
export function caffeineBandsFor(claims, session) {
  const bands = [];
  for (const c of claims) {
    if (c.ingredient_code !== 'caffeine') continue;
    for (const t of c.justified_timings || []) {
      if (!conditionsMatch(c, session).ok) continue;
      const d = resolveDose(c, t, claims);
      if (d?.kind === 'per_kg') bands.push({ timing: t, lo: d.lo, hi: d.hi, tier: d.tier, claim_id: c.claim_id });
    }
  }
  return bands;
}

const floor1 = (x) => Math.floor(x * 10 + 1e-9) / 10;

/** Limita las porciones/h máximas de un plan por hora (p. ej. por la cafeína acumulada). */
function capRatePlan(plan, maxPerHour, amount, nutrient) {
  const hi = Math.max(plan.servings_per_hour[0], floor1(maxPerHour));
  const gLo = plan.achievable_g_per_hour[0];
  const gHi = round(hi * amount.amount, 0);
  return { ...plan, servings_per_hour: [plan.servings_per_hour[0], hi], achievable_g_per_hour: [gLo, gHi],
    quantity: `${plan.servings_per_hour[0]}–${hi} porciones/h (≈${gLo}–${gHi} g/h de ${NUTRIENT_LABEL[nutrient] || nutrient})` };
}

const TARGET_UNIT = { rate: 'g/h', per_kg: 'mg/kg', concentration: 'mg/L' };
/** Objetivo derivado del claim (no del producto). */
export function targetOf(pair) {
  const d = pair.dose || {};
  return { nutrient: pair.nutrient, min: d.lo ?? null, max: d.hi ?? null, unit: TARGET_UNIT[d.kind] || d.unit || null, tier: pair.tier };
}

/** Plan de uso calculado por el servidor (porciones/h, intervalo, totales, cafeína acumulada del producto). */
export function usagePlanOf(pair, session, caffeine) {
  const p = pair.plan;
  const hours = session?.durationMin ? session.durationMin / 60 : null;
  const base = p.type === 'rate'
    ? {
      type: 'rate',
      servings_per_hour_min: p.servings_per_hour[0],
      servings_per_hour_max: p.servings_per_hour[1],
      interval_minutes_min: Math.round(60 / p.servings_per_hour[1]),
      interval_minutes_max: Math.round(60 / p.servings_per_hour[0]),
      achievable: { min: p.achievable_g_per_hour[0], max: p.achievable_g_per_hour[1], unit: 'g/h' },
      servings_total_min: hours ? round(p.servings_per_hour[0] * hours) : null,
      servings_total_max: hours ? round(p.servings_per_hour[1] * hours) : null,
      repeat_same_product: true,
    }
    : {
      type: 'servings',
      servings: p.servings,
      ...(p.concentration_mg_per_l != null ? { concentration_mg_per_l: p.concentration_mg_per_l } : {}),
      ...(p.dose_mg_per_kg != null ? { dose_mg_per_kg: p.dose_mg_per_kg } : {}),
    };
  const w = session?.weightKg;
  return {
    ...base,
    per_serving: { nutrient: pair.nutrient, amount: pair.amount.amount, unit: pair.amount.unit || null },
    caffeine: caffeine && caffeine.max > 0
      ? { mg_min: round(caffeine.min, 0), mg_max: round(caffeine.max, 0),
        mg_per_kg_min: w ? round(caffeine.min / w, 2) : null, mg_per_kg_max: w ? round(caffeine.max / w, 2) : null }
      : null,
    text: p.quantity,
  };
}

// Orden de desempate del principal de un hueco (de más a menos importante). La similitud vectorial solo entra al
// final, dentro de "score". Cada criterio: [motivo si la alternativa pierde en él, valor (mayor = mejor)].
const bestOf = (pair, f) => Math.max(...pair.supporting.map(f));
const RANK_CRITERIA = [
  ['banda de evidencia contextual (respaldo menor)', (c) => (c.pair.tier === 'principal' ? 1 : 0)],
  ['evidencia científica menos fuerte', (c) => bestOf(c.pair, (s) => LEVEL_WEIGHT[s.claim.source_evidence_level] ?? 0.5)],
  ['relación con la evidencia menos directa', (c) => bestOf(c.pair, (s) => RELATION_WEIGHT[s.relation] ?? 0.5)],
  ['cadencia no verificada por la ficha oficial', (c) => (c.pair.status === 'cadence_verified' ? 1 : 0)],
  ['alcanza menos del objetivo con la cadencia oficial', (c) => (c.pair.plan.type === 'rate'
    ? c.pair.plan.achievable_g_per_hour[1] / (c.pair.plan.target_g_per_hour[1] || 1) : 1)],
  ['necesita más porciones para el mismo objetivo', (c) => -(c.pair.plan.type === 'rate' ? c.pair.plan.servings_per_hour[0] : (c.pair.plan.servings ?? 1))],
  ['condiciones del claim menos específicas para esta sesión', (c) => (c.pair.supporting.some((s) => s.structured) ? 1 : 0)],
  ['no cubre a la vez la cafeína, o aporta cafeína que no se busca en este hueco', (c) => c.caffeineFit],
  ['sin feedback positivo del usuario', (c) => (c.pair.positive ? 1 : 0)],
  ['menor puntuación de evidencia (incluye similitud semántica)', (c) => c.pair.score],
  ['', (c) => -c.pair.product_id],
];
function compareCandidates(a, b) {
  for (const [, f] of RANK_CRITERIA) {
    const d = f(b) - f(a);
    if (Math.abs(d) > 1e-9) return d;
  }
  return 0;
}
function lossReason(primary, alt) {
  for (const [label, f] of RANK_CRITERIA) {
    if (Math.abs(f(primary) - f(alt)) > 1e-9) return label || 'evidencia y plan equivalentes (desempate estable)';
  }
  return 'evidencia y plan equivalentes (desempate estable)';
}

const mergeBy = (lists, key) => {
  const seen = new Set();
  return lists.flat().filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
};

/**
 * Selección por huecos (fase + función): 1 principal por hueco, hasta 2 alternativas (no cuentan), máximo 5
 * principales y una recomendación por producto. Un producto que cubre varias funciones de su fase ocupa todos esos
 * huecos como UNA recomendación. La cafeína se acumula en toda la sesión (todas las porciones y fases) y solo se
 * limita con las bandas de los claims revisados. Nunca rellena fases ni obliga a variar de producto.
 */
export function selectSlots(eligible, { session = {}, caffeineBands = [], max = MAX_RECOMMENDATIONS, maxAlternatives = MAX_ALTERNATIVES } = {}) {
  const w = session.weightKg;
  const hours = session.durationMin ? session.durationMin / 60 : 1;
  // Bandas de los claims que aplican a los momentos en que se consume cafeína (si ninguna aplica a ese momento,
  // las de la sesión). Nunca una frontera que no declare un claim revisado.
  const bandsFor = (timings) => {
    const own = caffeineBands.filter((b) => timings.has(b.timing));
    return own.length ? own : caffeineBands;
  };
  const coverLoFor = (timings) => { const b = bandsFor(timings); return b.length ? Math.min(...b.map((x) => x.lo)) : null; };
  const budgetFor = (timings) => {
    const his = bandsFor(timings).map((x) => x.hi).filter((x) => x != null);
    return his.length ? Math.max(...his) : null;
  };
  const mgkg = (mg) => (w ? mg / w : null);
  const decisions = [];

  // Pares por producto y fase (uno por función) y candidatos por hueco
  const byProductPhase = new Map();
  for (const pair of eligible) {
    const fn = functionOf(pair.nutrient, pair.timing);
    const key = `${pair.product_id}|${pair.phase}`;
    if (!byProductPhase.has(key)) byProductPhase.set(key, new Map());
    const m = byProductPhase.get(key);
    if (!m.has(fn) || m.get(fn).score < pair.score) m.set(fn, pair);
  }
  const slots = new Map();
  for (const fns of byProductPhase.values()) {
    for (const [fn, pair] of fns) {
      const hasCaffeine = (pair.caffeine_mg_per_serving || 0) > 0;
      const caffeineFit = fn === 'caffeine' || !hasCaffeine ? 0 : (fns.has('caffeine') ? 1 : -1);
      const slotKey = `${pair.phase}|${fn}`;
      if (!slots.has(slotKey)) slots.set(slotKey, { phase: pair.phase, fn, candidates: [] });
      slots.get(slotKey).candidates.push({ fn, pair, fns, caffeineFit });
    }
  }
  for (const s of slots.values()) s.candidates.sort(compareCandidates);

  // Orden de llenado: por función y, dentro de cada función, por la puntuación de su mejor candidato
  const order = [...slots.values()].sort((a, b) => FUNCTIONS.indexOf(a.fn) - FUNCTIONS.indexOf(b.fn)
    || b.candidates[0].pair.score - a.candidates[0].pair.score || PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  const chosen = [];
  const filled = new Map(); // `${fase}|${función}` → recomendación
  // Un producto puede repetirse en fases distintas (huecos distintos), pero no ocupar dos huecos de la misma fase
  // salvo como also_covers de una única recomendación.
  const usedProducts = new Set(); // `${producto}|${fase}`
  const used = (pair) => usedProducts.has(`${pair.product_id}|${pair.phase}`);
  const acc = { min: 0, max: 0, timings: new Set() }; // cafeína acumulada (mg) de los principales y sus momentos

  // ¿Cabe la cafeína de este candidato (todas sus porciones) en la banda de los claims? Si el plan por hora solo
  // excede en su extremo alto, se limitan las porciones/h; si el mínimo necesario ya excede, se descarta.
  const fitCaffeine = (cand, base) => {
    const perServing = cand.pair.caffeine_mg_per_serving || 0;
    let plan = cand.pair.plan;
    let c = caffeineOfPlan(perServing, plan, session);
    if (!perServing) return { ok: true, plan, caffeine: c, warnings: [] };
    const timings = new Set([...base.timings, cand.pair.timing]);
    const budgetHi = budgetFor(timings);
    if (budgetHi == null || !w) {
      return { ok: true, plan, caffeine: c, warnings: ['Sin claim revisado de cafeína aplicable (o sin peso) para acotar la cafeína acumulada.'] };
    }
    const totalMin = mgkg(base.min + c.min);
    if (totalMin > budgetHi + 1e-9) {
      const how = plan.type === 'rate' ? `${plan.servings_per_hour[0]} porciones/h durante ${round(hours)} h` : `${plan.servings ?? 1} porción(es)`;
      return { ok: false, reason: `con el plan necesario (${how}) la cafeína acumulada de la sesión sería ${round(totalMin, 2)} mg/kg y los claims revisados aplicables admiten como máximo ${budgetHi} mg/kg` };
    }
    const warnings = [];
    if (mgkg(base.max + c.max) > budgetHi + 1e-9) {
      if (plan.type !== 'rate') return { ok: false, reason: `la cafeína acumulada superaría ${budgetHi} mg/kg` };
      plan = capRatePlan(plan, (budgetHi * w - base.max) / (hours * perServing), cand.pair.amount, cand.pair.nutrient);
      c = caffeineOfPlan(perServing, plan, session);
      warnings.push(`Porciones/h limitadas a ${plan.servings_per_hour[1]} para que la cafeína acumulada no supere ${budgetHi} mg/kg.`);
    }
    return { ok: true, plan, caffeine: c, warnings };
  };

  for (const slot of order) {
    const slotKey = `${slot.phase}|${slot.fn}`;
    if (filled.has(slotKey)) continue;
    const slotTiming = slot.candidates[0].pair.timing;
    const coverLo = coverLoFor(new Set([slotTiming]));
    if (slot.fn === 'caffeine' && coverLo != null && w && mgkg(acc.min) >= coverLo - 1e-9) {
      decisions.push({ slot: slotKey, reason: `cafeína ya cubierta por los productos principales (${round(mgkg(acc.min), 2)} mg/kg); no se añade otro producto cafeinado` });
      continue;
    }
    if (chosen.length >= max) { decisions.push({ slot: slotKey, reason: `máximo de ${max} recomendaciones principales` }); continue; }

    for (const cand of slot.candidates) {
      if (used(cand.pair)) continue;
      const fit = fitCaffeine(cand, acc);
      if (!fit.ok) {
        cand.excluded = fit.reason;
        decisions.push({ slot: slotKey, product_id: cand.pair.product_id, excluded: true, reason: fit.reason });
        continue;
      }
      const pair = fit.plan === cand.pair.plan ? cand.pair : { ...cand.pair, plan: fit.plan };
      // Otras funciones de la misma fase que el mismo producto también cubre (si su hueco sigue libre)
      const alsoPairs = [];
      for (const [fn, other] of cand.fns) {
        if (fn === slot.fn || filled.has(`${slot.phase}|${fn}`)) continue;
        if (fn === 'caffeine') {
          // Cubre la cafeína solo si la cafeína acumulada (todas sus porciones) alcanza la banda de los claims
          const total = mgkg(acc.min + fit.caffeine.min);
          if (coverLo == null || total == null || total < coverLo - 1e-9) continue;
        }
        alsoPairs.push({ fn, pair: other });
      }
      const rec = {
        ...pair,
        role: slot.fn,
        also_covers: alsoPairs.map((a) => a.fn),
        also_pairs: alsoPairs.map((a) => a.pair),
        supporting: mergeBy([pair.supporting, ...alsoPairs.map((a) => a.pair.supporting)], (s) => s.claim.claim_id),
        caveats: mergeBy([pair.caveats, ...alsoPairs.map((a) => a.pair.caveats)], (c) => c.claim.claim_id),
        doseRefs: mergeBy([pair.doseRefs, ...alsoPairs.map((a) => a.pair.doseRefs)], (c) => c.claim_id),
        warnings: [...(pair.warnings || []), ...fit.warnings],
        caffeine: fit.caffeine,
        slotCandidate: cand,
        target: targetOf(pair),
        also_meets: alsoPairs.map((a) => targetOf(a.pair)),
      };
      chosen.push(rec);
      usedProducts.add(`${pair.product_id}|${pair.phase}`);
      filled.set(slotKey, rec);
      alsoPairs.forEach((a) => filled.set(`${slot.phase}|${a.fn}`, rec));
      acc.min += fit.caffeine.min;
      acc.max += fit.caffeine.max;
      if (fit.caffeine.max > 0) acc.timings.add(pair.timing);
      break;
    }
  }

  for (const rec of chosen) rec.usage_plan = usagePlanOf(rec, session, rec.caffeine);

  // Alternativas: mismo hueco, en lugar de (no además). Nunca un producto descartado por su cafeína, ni otro principal.
  for (const rec of chosen) {
    const slot = slots.get(`${rec.phase}|${rec.role}`);
    const base = { min: acc.min - rec.caffeine.min, max: acc.max - rec.caffeine.max, timings: acc.timings };
    rec.alternatives = [];
    for (const cand of slot.candidates) {
      if (rec.alternatives.length >= maxAlternatives) break;
      if (cand === rec.slotCandidate || used(cand.pair) || cand.excluded) continue;
      const fit = fitCaffeine(cand, base);
      if (!fit.ok) continue;
      rec.alternatives.push({
        product_id: cand.pair.product_id,
        product_name: cand.pair.product_name,
        cadence_status: cand.pair.status,
        usage_plan: usagePlanOf({ ...cand.pair, plan: fit.plan }, session, fit.caffeine),
        reason: lossReason(rec.slotCandidate, cand),
      });
    }
  }

  // Producto cafeinado con carbohidrato en la misma fase que el principal de combustible: sus gramos cuentan dentro
  // del objetivo de carbohidrato y sustituyen porciones del principal (no se suman además).
  for (const caf of chosen.filter((r) => r.role === 'caffeine')) {
    const fuel = chosen.find((r) => r !== caf && r.phase === caf.phase && r.role === 'fueling' && r.nutrient === 'carbohydrate');
    const cho = (caf.carbohydrate_per_serving || 0) * (caf.plan.servings ?? 1);
    if (!fuel || !(cho > 0)) continue;
    const replaces = round(cho / fuel.amount.amount);
    caf.usage_plan.replaces = { product_id: fuel.product_id, product_name: fuel.product_name, servings: replaces, carbohydrate_g: round(cho, 0) };
    fuel.usage_plan.includes = [...(fuel.usage_plan.includes || []),
      { product_id: caf.product_id, product_name: caf.product_name, carbohydrate_g: round(cho, 0), replaces_servings: replaces }];
  }

  const selected = chosen.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    || FUNCTIONS.indexOf(a.role) - FUNCTIONS.indexOf(b.role));
  const caffeine = acc.max > 0
    ? { mg_min: round(acc.min, 0), mg_max: round(acc.max, 0), mg_per_kg_min: w ? round(acc.min / w, 2) : null,
      mg_per_kg_max: w ? round(acc.max / w, 2) : null,
      band: budgetFor(acc.timings) != null ? { min: coverLoFor(acc.timings), max: budgetFor(acc.timings), unit: 'mg/kg' } : null }
    : null;
  return { selected, decisions, caffeine };
}

/** Compatibilidad: solo las recomendaciones principales de selectSlots. */
export function selectRecommendations(eligible, opts = {}) {
  return selectSlots(eligible, opts).selected;
}

// ------------------------------------------------------------------ Carga de datos (solo lectura)
export async function loadEligibilityInputs(productIds, { client = pool } = {}) {
  const ids = [...new Set(productIds.map(Number))];
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  const products = await q(
    `SELECT p.product_id, p.name, p.type_id, pt.name AS type_name, r.roles, r.nutrients, r.classification_version
       FROM products p JOIN product_types pt USING (type_id)
       LEFT JOIN product_type_functional_roles r USING (type_id)
      WHERE p.product_id = ANY($1::int[]) AND p.is_active`, [ids]);
  const ingredients = await q(
    `SELECT pi.product_id, i.ingredient_id, i.code, i.category, pi.amount::float AS amount, pi.unit, pi.basis, pi.serving_description
       FROM product_ingredients pi JOIN ingredients i USING (ingredient_id)
      WHERE pi.product_id = ANY($1::int[]) AND i.is_active`, [ids]);
  const formulations = await q(
    `SELECT pf.product_id, pf.formulation_id, f.code FROM product_formulations pf JOIN formulations f USING (formulation_id)
      WHERE pf.product_id = ANY($1::int[])`, [ids]);
  const instructions = await q(
    `SELECT c.claim_id, c.source_id, c.product_id, c.timing_context, c.frequency, c.dose_value::float AS dose_value,
            c.dose_value_max::float AS dose_value_max, c.dose_unit, c.conditions, c.result_summary, s.source_key, s.title, s.url
       FROM evidence_claims c JOIN evidence_sources s USING (source_id)
      WHERE s.source_category = 'manufacturer_specification' AND s.review_status = 'reviewed' AND c.review_status = 'reviewed'
        AND c.claim_type = 'usage_instruction' AND c.product_id = ANY($1::int[])`, [ids]);
  const roleRows = await q('SELECT role, nutrient, timings FROM functional_role_nutrients');

  const ingredientIds = [...new Set(ingredients.map((i) => i.ingredient_id))];
  const formulationIds = [...new Set(formulations.map((f) => f.formulation_id))];
  const claims = await q(
    `SELECT c.claim_id, c.source_id, c.claim_key, c.claim_type, c.ingredient_id, c.formulation_id, c.product_id,
            c.timing_context, c.timing_evidence_strength, c.effect_direction, c.statistical_significance, c.outcome,
            c.result_summary, c.population, c.conditions, c.dose_text, c.dose_value::float AS dose_value,
            c.dose_value_max::float AS dose_value_max, c.dose_unit, c.frequency, c.exercise_duration_min_minutes,
            c.exercise_duration_max_minutes, c.evidence_strength, c.limitations,
            s.source_key, s.title AS source_title, s.year AS source_year, s.source_type, s.source_category,
            s.evidence_level AS source_evidence_level, s.doi, s.pmid, s.url,
            i.code AS ingredient_code, i.category AS ingredient_category, f.code AS formulation_code,
            COALESCE((SELECT array_agg(DISTINCT t.timing) FROM v_claim_timing_support t
                       WHERE t.claim_id = c.claim_id AND t.can_justify_timing), '{}') AS justified_timings,
            COALESCE((SELECT array_agg(cc.chunk_id ORDER BY cc.chunk_id) FROM evidence_claim_chunks cc
                       WHERE cc.claim_id = c.claim_id), '{}') AS chunk_ids
       FROM evidence_claims c JOIN evidence_sources s USING (source_id)
       LEFT JOIN ingredients i ON i.ingredient_id = c.ingredient_id
       LEFT JOIN formulations f ON f.formulation_id = c.formulation_id
      WHERE c.review_status = 'reviewed' AND s.review_status = 'reviewed'
        AND s.source_category <> 'manufacturer_specification'
        AND (c.ingredient_id = ANY($1::int[]) OR c.formulation_id = ANY($2::int[]))`, [ingredientIds, formulationIds]);

  const roleMatrix = {};
  for (const r of roleRows) (roleMatrix[r.role] ||= {})[r.nutrient] = r.timings;

  for (const p of products) {
    p.ingredients = ingredients.filter((i) => i.product_id === p.product_id);
    p.formulation_ids = formulations.filter((f) => f.product_id === p.product_id).map((f) => f.formulation_id);
    p.formulation_codes = formulations.filter((f) => f.product_id === p.product_id).map((f) => f.code);
    p.instructions = instructions.filter((i) => i.product_id === p.product_id);
  }
  return { products, claims, roleMatrix, ingredientIds, formulationIds };
}
