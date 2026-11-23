// services/evidenceRecommendationService.js — Flujo Evidence RAG (solo con USE_EVIDENCE_RAG=true).
//
// perfil + sesión → productos candidatos → ingredientes/formulaciones → elegibilidad basada en claims revisados
// → similitud pgvector (chunks revisados de esos sujetos) → ranking → huecos fase + función (1 principal, hasta 2
// alternativas, cafeína acumulada) → contexto → Gemini redacta (o respaldo determinista) → validación → recomendaciones con su evidencia (recommendation_evidence).
import pool from '../config/db.js';
import { generateEmbedding, TASK_TYPES } from './embeddingServices.js';
import { searchEvidenceChunks } from './evidenceRetrievalService.js';
import {
  normalizeSession, loadEligibilityInputs, computeEligibility, selectSlots,
  PHASE_ORDER, PHASE_TO_TIMING,
} from './evidenceEligibilityService.js';
import { buildEvidenceContext, buildEvidencePrompt, validateEvidenceResponse, buildDeterministicResponse } from './evidencePromptService.js';
import { callLLMJson, isLLMAvailable } from './llmService.js';
import { passesHardFilters } from './retrievalService.js';
import Feedback from '../models/feedbackModel.js';

let llmOverride = null;
/** Solo pruebas: sustituye la llamada al LLM por una función ({ prompt, context, refs, selected }) → respuesta. */
export function setEvidenceLLMForTests(fn) {
  llmOverride = fn;
}

/**
 * Candidatos estructurales (recuperación híbrida): productos activos cuyo tipo tiene un rol funcional compatible
 * y que contienen —con cantidad declarada— un nutriente, o declaran una formulación, que algún claim revisado
 * habilita para algún momento. Aplica los mismos filtros duros que el recuperador vectorial (dieta, cafeína,
 * feedback negativo). La similitud vectorial NO decide si se evalúan: solo ordena después.
 */
export async function getStructuralCandidates({ profile = {}, client = pool } = {}) {
  const excluded = profile.user_id ? await Feedback.getNegativeFeedbackProducts(profile.user_id).catch(() => []) : [];
  const { rows } = await client.query(
    `SELECT p.product_id, string_agg(DISTINCT pa.name, ',') AS attributes, MAX(pn.caffeine_mg)::float AS caffeine_mg
       FROM products p
       JOIN product_type_functional_roles r ON r.type_id = p.type_id AND NOT ('no_fueling' = ANY (r.roles))
       LEFT JOIN product_attributes_mapping pam ON pam.product_id = p.product_id
       LEFT JOIN product_attributes pa ON pa.attribute_id = pam.attribute_id
       LEFT JOIN product_nutrition pn ON pn.product_id = p.product_id
      WHERE p.is_active AND NOT (p.product_id = ANY ($1::int[]))
        AND (EXISTS (SELECT 1 FROM product_ingredients pi
                       JOIN ingredients i ON i.ingredient_id = pi.ingredient_id
                       JOIN v_claim_timing_support t ON t.ingredient_id = pi.ingredient_id AND t.can_justify_timing
                      WHERE pi.product_id = p.product_id AND pi.amount IS NOT NULL AND i.code = ANY (r.nutrients))
          OR EXISTS (SELECT 1 FROM product_formulations pf
                       JOIN v_claim_timing_support t ON t.formulation_id = pf.formulation_id AND t.can_justify_timing
                      WHERE pf.product_id = p.product_id))
      GROUP BY p.product_id
      ORDER BY p.product_id`,
    [excluded.map(Number)]
  );
  return rows.filter((p) => passesHardFilters(p, profile)).map((p) => ({ product_id: p.product_id }));
}

/** Une los candidatos vectoriales/SQL con los estructurales, sin duplicados (orden vectorial primero). */
export function mergeCandidates(primary = [], structural = []) {
  const seen = new Set(primary.map((p) => Number(p.product_id)));
  const added = structural.filter((p) => !seen.has(Number(p.product_id)));
  return { candidates: [...primary, ...added], added: added.map((p) => p.product_id) };
}

export function buildSessionQueryText(profile, session) {
  return [
    `Suplementación deportiva basada en evidencia para una sesión de ${session.type || 'entrenamiento'}`,
    session.sport ? `deporte ${session.sport}` : null,
    session.durationMin ? `duración ${session.durationMin} minutos` : null,
    session.intensity ? `intensidad ${session.intensity}` : null,
    session.environment ? `ambiente ${session.environment}` : null,
    profile.primary_goal ? `objetivo ${profile.primary_goal}` : null,
    'carbohidratos, cafeína, proteína, sodio: dosis y momento antes, durante y después del ejercicio',
  ].filter(Boolean).join('; ');
}

function summarizeOmittedPhases(finalPhases, eligible, rejected) {
  return PHASE_ORDER.filter((p) => !finalPhases.has(p)).map((phase) => {
    if (phase === 'diario') {
      return { timing: phase, reason: 'Ningún claim revisado justifica un uso diario para los productos candidatos (no se infiere de la categoría).' };
    }
    if (eligible.some((e) => e.phase === phase)) {
      return { timing: phase, reason: 'Había opciones con evidencia, pero no se seleccionaron para esta sesión.' };
    }
    const timing = PHASE_TO_TIMING[phase];
    const counts = {};
    for (const r of rejected.filter((x) => x.timing === timing)) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { timing: phase, reason: top ? `Sin evidencia aplicable: ${top}.` : 'Sin evidencia revisada que habilite esta fase con los productos candidatos.' };
  });
}

/** Filas de recommendation_evidence para una recomendación aceptada. */
/** Quita del plan las sustituciones que apuntan a recomendaciones que el LLM omitió. */
function planForAccepted(plan, acceptedIds) {
  if (!plan) return plan;
  const out = { ...plan };
  if (out.includes) out.includes = out.includes.filter((x) => acceptedIds.has(x.product_id));
  if (out.includes && !out.includes.length) delete out.includes;
  if (out.replaces && !acceptedIds.has(out.replaces.product_id)) delete out.replaces;
  return out;
}

/** Cafeína total de la sesión: suma de todas las porciones de todas las recomendaciones finales. */
export function sessionCaffeine(recommendations, session, band = null) {
  const parts = recommendations.map((r) => r.usage_plan?.caffeine).filter(Boolean);
  if (!parts.length) return null;
  const sum = (k) => parts.reduce((t, p) => t + (p[k] || 0), 0);
  const w = session?.weightKg;
  return { mg_min: sum('mg_min'), mg_max: sum('mg_max'),
    mg_per_kg_min: w ? Math.round((sum('mg_min') / w) * 100) / 100 : null,
    mg_per_kg_max: w ? Math.round((sum('mg_max') / w) * 100) / 100 : null, band };
}

/** Recomendación Evidence RAG → entrada de Recommendation.createRecommendationsBatch (mismo formato en todos los flujos). */
export function toRecommendationInput(rec, { userId, sessionId = null }) {
  return {
    userId,
    sessionId,
    productId: rec.product_id,
    reason: rec.reasoning,
    consumption_timing: rec.consumption_timing,
    consumption_instructions: [rec.interval_minutes ? `[interval_minutes=${rec.interval_minutes}]` : null, rec.instructions]
      .filter(Boolean).join(' ') || null,
    recommended_quantity: rec.quantity,
    timing_minutes: rec.timing_minutes,
    evidence_mode: 'evidence_rag',
    cadence_status: rec.cadence_status,
    evidence_note: rec.evidence_note,
    functional_role: rec.role,
    also_covers: rec.also_covers || [],
    target: rec.target || null,
    usage_plan: rec.usage_plan || null,
    alternatives: rec.alternatives || [],
    evidence: rec.evidence,
  };
}

export function buildEvidenceRows(accepted) {
  const rows = [];
  let rank = 0;
  const { pair } = accepted;
  const support = new Map(pair.supporting.map((s) => [s.claim.claim_id, s]));
  const relationOf = (claim) => (claim.formulation_id ? 'formulation' : claim.product_id ? 'direct_product' : 'ingredient');
  for (const c of accepted.cited) {
    const s = support.get(c.claim_id);
    const claim = s?.claim || pair.caveats.find((cv) => cv.claim.claim_id === c.claim_id)?.claim;
    const base = {
      source_id: claim.source_id, claim_id: claim.claim_id, relation_type: s?.relation || relationOf(claim), role: c.role,
      similarity: s ? Math.round(s.similarity * 1e5) / 1e5 : null, score: s ? Math.round(s.score * 1e5) / 1e5 : null,
    };
    if (c.chunks.length) c.chunks.forEach((k) => rows.push({ ...base, chunk_id: k.chunk_id, rank: ++rank }));
    else rows.push({ ...base, chunk_id: null, rank: ++rank });
  }
  for (const ref of pair.doseRefs) {
    if (rows.some((r) => r.claim_id === ref.claim_id)) continue;
    rows.push({ source_id: ref.source_id, claim_id: ref.claim_id, chunk_id: null, relation_type: relationOf(ref), role: 'dose_reference', similarity: null, score: null, rank: ++rank });
  }
  if (pair.instruction) {
    rows.push({ source_id: pair.instruction.source_id, claim_id: pair.instruction.claim_id, chunk_id: null,
      relation_type: 'manufacturer_specification', role: 'usage_constraint', similarity: null, score: null, rank: ++rank });
  }
  return rows;
}

/**
 * Genera recomendaciones fundamentadas. No persiste nada: devuelve las recomendaciones con sus filas de evidencia.
 * @returns {Promise<{recommendations: object[], omittedPhases: object[], llmReasoning: string, promptUsed: string|null,
 *   context: object|null, mode: 'llm'|'mock'|'fallback'|'none', discarded: object[]}>}
 */
export async function generateEvidenceRecommendations({ profile = {}, trainingData = {}, candidates = [], positiveProductIds = [], client = pool, transformInputs = null, hybrid = true } = {}) {
  const session = normalizeSession(trainingData, profile);
  // Recuperación híbrida: el top-K vectorial nunca deja fuera un producto estructuralmente elegible
  const structural = hybrid ? await getStructuralCandidates({ profile, client }) : [];
  const merged = mergeCandidates(candidates, structural);
  candidates = merged.candidates;
  const candidateStats = { vector: candidates.length - merged.added.length, structural_added: merged.added.length, added_ids: merged.added };
  const inputs = await loadEligibilityInputs(candidates.map((p) => p.product_id), { client });
  // Solo validación previa a una ingesta: aplica en memoria cambios de manifiesto aún no ingeridos (no escribe nada)
  if (typeof transformInputs === 'function') transformInputs(inputs);
  let { eligible, rejected, caffeineBands } = computeEligibility(inputs, session, { positiveProductIds });

  if (!eligible.length) {
    return {
      recommendations: [], omittedPhases: summarizeOmittedPhases(new Set(), eligible, rejected),
      llmReasoning: 'No hay evidencia revisada suficiente para recomendar productos en esta sesión.',
      promptUsed: null, context: null, mode: 'none', discarded: [], candidateStats,
    };
  }

  // Similitud semántica (pgvector, solo chunks revisados de los sujetos implicados)
  const supportingClaims = new Map();
  for (const pair of eligible) for (const s of pair.supporting) supportingClaims.set(s.claim.claim_id, s.claim);
  const ingredientIds = [...new Set([...supportingClaims.values()].map((c) => c.ingredient_id).filter(Boolean))];
  const formulationIds = [...new Set([...supportingClaims.values()].map((c) => c.formulation_id).filter(Boolean))];
  const chunkHits = new Map();
  try {
    const queryVector = await generateEmbedding(buildSessionQueryText(profile, session), { taskType: TASK_TYPES.query });
    const hits = await searchEvidenceChunks(queryVector, { topK: 40, ingredientIds, formulationIds, client });
    hits.forEach((h) => chunkHits.set(h.chunk_id, h));
  } catch (error) {
    console.warn('⚠️ Evidence RAG: búsqueda vectorial no disponible, ranking sin similitud:', error.message);
  }
  const similarity = new Map();
  for (const claim of inputs.claims) {
    const sims = (claim.chunk_ids || []).map((id) => chunkHits.get(id)?.similarity).filter((x) => x != null);
    if (sims.length) similarity.set(claim.claim_id, Math.max(...sims));
  }
  ({ eligible, rejected, caffeineBands } = computeEligibility(inputs, session, { similarity, positiveProductIds }));

  // La selección del principal de cada hueco es determinista y previa al LLM: Gemini solo redacta u omite.
  const slotResult = selectSlots(eligible, { session, caffeineBands });
  const selected = slotResult.selected;
  const shortlist = selected;

  // Fragmentos recuperables de los claims del contexto (solo evidencia revisada)
  const contextClaimIds = [...new Set(shortlist.flatMap((p) => p.supporting.map((s) => s.claim.claim_id)))];
  const claimById = new Map(inputs.claims.map((c) => [c.claim_id, c]));
  const chunkIds = [...new Set(contextClaimIds.flatMap((id) => claimById.get(id)?.chunk_ids || []))];
  const { rows: chunkRows } = chunkIds.length
    ? await client.query(`SELECT chunk_id, source_id, heading, content FROM v_retrievable_evidence_chunks WHERE chunk_id = ANY($1::int[])`, [chunkIds])
    : { rows: [] };
  const chunksByClaim = new Map();
  for (const id of contextClaimIds) {
    const own = (claimById.get(id)?.chunk_ids || []).map((cid) => chunkRows.find((r) => r.chunk_id === cid)).filter(Boolean);
    own.sort((a, b) => (chunkHits.get(b.chunk_id)?.similarity ?? 0) - (chunkHits.get(a.chunk_id)?.similarity ?? 0));
    chunksByClaim.set(id, own.slice(0, 2));
  }

  const omittedBefore = summarizeOmittedPhases(new Set(shortlist.map((p) => p.phase)), [], rejected);
  const { context, refs } = buildEvidenceContext({ profile, session, shortlist, chunksByClaim, omittedPhases: omittedBefore });
  const prompt = buildEvidencePrompt(context);

  let mode;
  let response;
  if (llmOverride) {
    try {
      mode = 'llm';
      response = await llmOverride({ prompt, context, refs, selected, shortlist });
    } catch (error) {
      mode = 'fallback';
      response = buildDeterministicResponse({ selected, refs });
    }
  } else if (process.env.MOCK_LLM === 'true') {
    mode = 'mock';
    response = buildDeterministicResponse({ selected, refs });
  } else if (!isLLMAvailable()) {
    mode = 'fallback';
    response = buildDeterministicResponse({ selected, refs });
  } else {
    try {
      mode = 'llm';
      response = await callLLMJson(prompt);
    } catch (error) {
      console.error('Evidence RAG: error del LLM, se usa el respaldo determinista:', error.message);
      mode = 'fallback';
      response = buildDeterministicResponse({ selected, refs });
    }
  }

  let { accepted, discarded } = validateEvidenceResponse(response, { refs, shortlist });
  if (mode === 'llm' && !accepted.length && discarded.length) {
    // El modelo propuso algo, pero nada fue válido: se usa el respaldo determinista (también trazable)
    mode = 'fallback';
    ({ accepted } = validateEvidenceResponse(buildDeterministicResponse({ selected, refs }), { refs, shortlist }));
  }

  const acceptedIds = new Set(accepted.map((a) => a.pair.product_id));
  const recommendations = accepted.map((a) => ({
    product_id: a.pair.product_id,
    product_name: a.pair.product_name,
    consumption_timing: a.pair.phase,
    timing_minutes: a.timing_minutes,
    interval_minutes: a.pair.plan.type === 'rate' ? a.pair.plan.interval_minutes : null,
    quantity: a.pair.plan.quantity,
    instructions: a.instructions || null,
    reasoning: a.reasoning,
    evidence_note: a.evidence_note || null,
    cadence_status: a.pair.status,
    nutrient: a.pair.nutrient,
    role: a.pair.role,
    also_covers: a.pair.also_covers,
    target: a.pair.target,
    also_meets: a.pair.also_meets,
    usage_plan: planForAccepted(a.pair.usage_plan, acceptedIds),
    alternatives: a.pair.alternatives,
    warnings: a.pair.warnings,
    evidence: buildEvidenceRows(a),
  }));
  const finalPhases = new Set(recommendations.map((r) => r.consumption_timing));
  const omittedPhases = summarizeOmittedPhases(finalPhases, eligible, rejected);
  if (Array.isArray(response?.omitted_phases)) {
    for (const o of response.omitted_phases) {
      const target = omittedPhases.find((x) => x.timing === o?.timing);
      if (target && typeof o.reason === 'string' && o.reason.trim()) target.reason = o.reason.trim().slice(0, 300);
    }
  }

  return {
    recommendations,
    omittedPhases,
    llmReasoning: typeof response?.llm_overall_reasoning === 'string' ? response.llm_overall_reasoning.slice(0, 500) : 'Recomendaciones basadas en evidencia.',
    promptUsed: prompt,
    context,
    mode,
    discarded,
    candidateStats,
    caffeine: sessionCaffeine(recommendations, session, slotResult.caffeine?.band),
    slotDecisions: slotResult.decisions,
  };
}
