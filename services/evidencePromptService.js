// services/evidencePromptService.js — Contexto para Gemini, validación de su respuesta y respaldo determinista.
//
// El contexto usa referencias cortas (P1, C1, S1, K1) que el servidor traduce a ids reales. Gemini solo puede
// redactar sobre las recomendaciones principales que el servidor ya eligió (una por hueco fase + función) y citar
// claims que el servidor le entregó; todo lo demás se descarta. No elige producto ni puede sustituir el principal
// por una alternativa. Cantidades e intervalos los fija el plan calculado por el servidor, no el modelo.
import { PHASE_ORDER, MAX_RECOMMENDATIONS, NUTRIENT_LABEL } from './evidenceEligibilityService.js';

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || null);
const FUNCTION_TEXT = {
  fueling: 'combustible (carbohidrato)', hydration: 'hidratación (sodio/líquidos)', protein_support: 'aporte de proteína',
  caffeine: 'cafeína', supplementation: 'suplementación',
};
const CADENCE_TEXT = {
  cadence_verified: 'verificada por la ficha oficial revisada',
  cadence_unverified: 'NO verificada: máximo 1 porción, sin repetir ni calcular tasas',
};

/** Construye el contexto con referencias cortas y el mapa ref → ids. */
export function buildEvidenceContext({ profile, session, shortlist, chunksByClaim, omittedPhases = [] }) {
  const refs = { products: new Map(), claims: new Map(), sources: new Map(), chunks: new Map() };
  const ref = (map, prefix, key, value) => {
    if (!map.has(key)) map.set(key, { ref: `${prefix}${map.size + 1}`, ...value });
    return map.get(key).ref;
  };

  const productos = shortlist.map((pair) => {
    const claimRefs = pair.supporting.map((s) => {
      const c = s.claim;
      ref(refs.sources, 'S', c.source_id, { source: c });
      return ref(refs.claims, 'C', c.claim_id, { claim: c, relation: s.relation, role: 'apoyo', tier: s.tier });
    });
    const caveatRefs = pair.caveats.map((cv) => {
      ref(refs.sources, 'S', cv.claim.source_id, { source: cv.claim });
      return ref(refs.claims, 'C', cv.claim.claim_id, { claim: cv.claim, relation: cv.claim.formulation_id ? 'formulation' : 'ingredient', role: 'matiz' });
    });
    const pRef = ref(refs.products, 'P', `${pair.product_id}|${pair.phase}|${pair.nutrient}`, { pair });
    return {
      ref: pRef,
      product_id: pair.product_id,
      nombre: pair.product_name,
      tipo: pair.type_name,
      rol_funcional: pair.roles,
      fase: pair.phase,
      funcion: pair.role ? FUNCTION_TEXT[pair.role] : undefined,
      tambien_cubre: pair.also_covers?.length ? pair.also_covers.map((fn) => FUNCTION_TEXT[fn]) : undefined,
      nutriente: NUTRIENT_LABEL[pair.nutrient] || pair.nutrient,
      objetivo: pair.target ? `${pair.target.min ?? '…'}–${pair.target.max ?? '…'} ${pair.target.unit || ''}`.trim() : undefined,
      cantidad_por_porcion: `${pair.amount.amount} ${pair.amount.unit || ''} (${pair.amount.serving || pair.amount.basis})`,
      plan_calculado: pair.plan.quantity,
      cadencia: CADENCE_TEXT[pair.status],
      banda_de_evidencia: pair.tier === 'contextual' ? 'contextual (respaldo menor e incierto)' : 'principal',
      restricciones_ficha_oficial: pair.instruction
        ? truncate([pair.instruction.frequency, pair.instruction.conditions?.notes].filter(Boolean).join('; '), 200)
        : null,
      cafeina_acumulada_del_producto: pair.usage_plan?.caffeine || undefined,
      sustituye: pair.usage_plan?.replaces
        ? `cuenta dentro del objetivo de carbohidrato: sustituye ${pair.usage_plan.replaces.servings} porción(es) de ${pair.usage_plan.replaces.product_name}` : undefined,
      avisos: pair.warnings,
      evidencia_apoyo: claimRefs,
      evidencia_matiz: caveatRefs,
    };
  });

  const evidencia = [...refs.claims.values()].map(({ ref: r, claim: c, relation, role, tier }) => ({
    ref: r,
    fuente: refs.sources.get(c.source_id).ref,
    rol: role,
    tipo: c.claim_type,
    sujeto: c.ingredient_code || c.formulation_code,
    relacion_con_producto: relation === 'formulation' ? 'formulación declarada por el producto' : 'ingrediente contenido en el producto (no es evidencia directa del producto)',
    momento: c.timing_context,
    fuerza_timing: c.timing_evidence_strength,
    direccion_efecto: c.effect_direction,
    resultado: truncate(c.result_summary, 320),
    dosis: c.dose_text || null,
    poblacion: c.population || null,
    condiciones: c.conditions && Object.keys(c.conditions).length ? c.conditions : null,
    limitaciones: truncate(c.limitations, 200),
    banda: tier === 'contextual' ? 'contextual' : undefined,
    fragmentos: (chunksByClaim.get(c.claim_id) || []).map((k) => ref(refs.chunks, 'K', k.chunk_id, { chunk: k, claim_id: c.claim_id })),
  }));

  const fuentes = [...refs.sources.values()].map(({ ref: r, source: c }) => ({
    ref: r, titulo: c.source_title, anio: c.source_year, tipo: c.source_type, categoria: c.source_category, nivel: c.source_evidence_level,
  }));
  const fragmentos = [...refs.chunks.values()].map(({ ref: r, chunk: k }) => ({ ref: r, fuente: refs.sources.get(k.source_id)?.ref, texto: truncate(k.content, 500) }));

  const context = {
    perfil: {
      peso_kg: session.weightKg, objetivo: profile.primary_goal || null, genero: profile.gender || null,
      tolerancia_cafeina: profile.caffeine_tolerance || null, restricciones: profile.dietary_restrictions || null,
      sudoracion: profile.sweat_level || null,
    },
    sesion: { tipo: session.type, deporte: session.sport, duracion_min: session.durationMin, intensidad: session.intensity, ambiente: session.environment },
    fases_con_evidencia: [...new Set(shortlist.map((p) => p.phase))].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b)),
    fases_sin_evidencia: omittedPhases,
    productos,
    evidencia,
    fuentes,
    fragmentos,
  };
  return { context, refs };
}

export function buildEvidencePrompt(context) {
  return `Eres SportNutriBot, asistente de nutrición deportiva basado en evidencia.
Recibes un CONTEXTO JSON con el perfil, la sesión, pares (producto, fase) ya validados por el servidor y la evidencia revisada recuperada.

REGLAS OBLIGATORIAS:
1. Cada entrada de "productos" es la recomendación PRINCIPAL que el servidor ya eligió para un hueco (fase + función). Usa su "ref" P, su "product_id" y su "fase" exactos. No elijas otro producto, no añadas productos ni fases y no propongas alternativas.
2. No es obligatorio cubrir todas las fases. Puedes OMITIR una entrada si la evidencia no la justifica para esta sesión. Máximo ${MAX_RECOMMENDATIONS} recomendaciones.
2b. Un mismo producto se repite durante la sesión según "plan_calculado"; no sugieras alternar o combinar productos distintos de la misma función. Si una entrada "sustituye" porciones de otra, explícalo así (en lugar de, no además).
3. Usa EXCLUSIVAMENTE la evidencia del contexto y cita sus refs C (y K si usas un fragmento). Cada recomendación debe citar al menos un claim de "evidencia_apoyo" de ese producto.
4. No inventes beneficios. La ficha del fabricante nunca demuestra eficacia: solo indica forma o frecuencia de uso.
5. La evidencia de un ingrediente o de una formulación NO es evidencia directa del producto: dilo así.
6. Señala explícitamente la evidencia limitada, contextual, neutral, mixta o insuficiente (claims con rol "matiz" o banda "contextual"). No presentes la banda contextual como equivalente a la principal.
7. Respeta dosis, momento, condiciones y población de cada claim. Si extrapolas a otra población, indícalo.
8. No modifiques "plan_calculado": la cantidad la fija el servidor. Si la cadencia NO está verificada, no propongas repetir el producto.

Devuelve SOLO JSON con esta forma:
{
  "recommendations": [
    { "product_ref": "P1", "product_id": 0, "consumption_timing": "antes|durante|despues|diario",
      "timing_minutes": null, "instructions": "…", "reasoning": "…",
      "evidence": [ { "claim_ref": "C1", "chunk_refs": ["K1"], "role": "supports|caveat" } ],
      "evidence_note": "…" }
  ],
  "omitted_phases": [ { "timing": "diario", "reason": "…" } ],
  "llm_overall_reasoning": "…"
}

CONTEXTO:
${JSON.stringify(context)}`;
}

/**
 * Valida la respuesta del modelo contra el contexto. Descarta (con motivo) todo lo que no cumpla:
 * producto/fase no elegible, sin claim de apoyo citado, refs inexistentes, límites de cantidad.
 */
export function validateEvidenceResponse(response, { refs, shortlist }) {
  const productByRef = new Map([...refs.products.values()].map((p) => [p.ref, p.pair]));
  const claimByRef = new Map([...refs.claims.values()].map((c) => [c.ref, c]));
  const chunkByRef = new Map([...refs.chunks.values()].map((k) => [k.ref, k]));
  const accepted = [];
  const discarded = [];
  const usedProducts = new Set();

  for (const rec of Array.isArray(response?.recommendations) ? response.recommendations : []) {
    const reject = (reason) => discarded.push({ rec, reason });
    let pair = productByRef.get(rec?.product_ref);
    if (!pair) {
      pair = shortlist.find((p) => p.product_id === Number(rec?.product_id) && p.phase === rec?.consumption_timing);
    }
    if (!pair) { reject(`par no elegible (${rec?.product_ref ?? rec?.product_id}/${rec?.consumption_timing})`); continue; }
    if (rec.consumption_timing && rec.consumption_timing !== pair.phase) { reject('fase distinta de la elegible'); continue; }
    if (Number(rec.product_id) && Number(rec.product_id) !== pair.product_id) { reject('product_id no coincide con la ref'); continue; }
    if (usedProducts.has(`${pair.product_id}|${pair.phase}`)) { reject('producto repetido en la misma fase'); continue; }
    if (accepted.length >= MAX_RECOMMENDATIONS) { reject('máximo de recomendaciones'); continue; }

    const supportIds = new Set(pair.supporting.map((s) => s.claim.claim_id));
    const caveatIds = new Set(pair.caveats.map((c) => c.claim.claim_id));
    const cited = [];
    let invalid = null;
    for (const e of Array.isArray(rec.evidence) ? rec.evidence : []) {
      const c = claimByRef.get(e?.claim_ref);
      if (!c) { invalid = `claim inexistente (${e?.claim_ref})`; break; }
      const id = c.claim.claim_id;
      if (!supportIds.has(id) && !caveatIds.has(id)) { invalid = `claim ${e.claim_ref} no pertenece a este producto`; break; }
      const chunks = [];
      for (const kr of Array.isArray(e.chunk_refs) ? e.chunk_refs : []) {
        const k = chunkByRef.get(kr);
        if (!k || k.chunk.source_id !== c.claim.source_id) { invalid = `fragmento inválido (${kr})`; break; }
        chunks.push(k.chunk);
      }
      if (invalid) break;
      cited.push({ claim_id: id, role: supportIds.has(id) ? 'supports' : 'caveat', chunks });
    }
    if (invalid) { reject(invalid); continue; }
    if (!cited.some((c) => c.role === 'supports')) { reject('no cita ningún claim de apoyo recuperado'); continue; }

    const minutes = Number(rec.timing_minutes);
    accepted.push({
      pair,
      cited,
      reasoning: truncate(String(rec.reasoning || ''), 480) || 'Recomendación respaldada por la evidencia citada.',
      instructions: truncate(String(rec.instructions || ''), 400),
      evidence_note: truncate(String(rec.evidence_note || ''), 400),
      timing_minutes: Number.isInteger(minutes) && minutes >= 0 && minutes <= 180 ? minutes : null,
    });
    usedProducts.add(`${pair.product_id}|${pair.phase}`);
  }
  accepted.sort((a, b) => PHASE_ORDER.indexOf(a.pair.phase) - PHASE_ORDER.indexOf(b.pair.phase));
  return { accepted, discarded };
}

/** Respuesta determinista (sin LLM): mock de pruebas y respaldo ante errores del modelo. */
export function buildDeterministicResponse({ selected, refs }) {
  const refOfProduct = (pair) => [...refs.products.values()].find((p) => p.pair === pair)?.ref;
  const refOfClaim = (id) => [...refs.claims.values()].find((c) => c.claim.claim_id === id)?.ref;
  const refsOfChunks = (claimId) => [...refs.chunks.values()].filter((k) => k.claim_id === claimId).slice(0, 1).map((k) => k.ref);
  return {
    recommendations: selected.map((pair) => {
      const top = pair.supporting[0].claim;
      const note = [
        pair.supporting.every((s) => s.relation !== 'direct_product') ? 'Evidencia del ingrediente o la formulación, no del producto específico.' : null,
        pair.tier === 'contextual' ? 'Dosis en la banda contextual: respaldo menor e incierto.' : null,
        pair.status === 'cadence_unverified' ? 'Frecuencia no verificada por el fabricante: máximo 1 porción.' : null,
        pair.caveats.length ? 'Hay evidencia neutral o insuficiente relacionada.' : null,
      ].filter(Boolean).join(' ');
      return {
        product_ref: refOfProduct(pair),
        product_id: pair.product_id,
        consumption_timing: pair.phase,
        timing_minutes: null,
        instructions: pair.instruction?.frequency ? `Según la ficha oficial: ${pair.instruction.frequency}.` : null,
        reasoning: `${top.source_title} (${top.source_year ?? 's. f.'}): ${truncate(top.result_summary, 300)}`,
        evidence: [
          ...pair.supporting.slice(0, 2).map((s) => ({ claim_ref: refOfClaim(s.claim.claim_id), chunk_refs: refsOfChunks(s.claim.claim_id), role: 'supports' })),
          ...pair.caveats.slice(0, 1).map((c) => ({ claim_ref: refOfClaim(c.claim.claim_id), chunk_refs: [], role: 'caveat' })),
        ],
        evidence_note: note || null,
      };
    }),
    omitted_phases: [],
    llm_overall_reasoning: 'Selección determinista basada en el ranking de evidencia.',
  };
}
