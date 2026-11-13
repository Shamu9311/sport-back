// services/evidenceRetrievalService.js — Consultas sobre la base de evidencia curada.
//
// ⚠️ AISLADO: ningún servicio del recomendador importa este módulo todavía (USE_EVIDENCE_RAG=false).
// Solo se usa en pruebas y servirá de base para la fase siguiente:
//
//   perfil + entrenamiento → productos candidatos → ingredientes/formulaciones relevantes
//     → evidence retrieval (este módulo) → chunks + claims → ranking similitud + calidad → Gemini
//
// La recuperación ocurre DESPUÉS de conocer los candidatos; nunca se busca libremente en internet.
// Solo devuelve evidencia 'reviewed' (vistas v_retrievable_*); 'draft' y 'retired' quedan excluidas.
import pool from '../config/db.js';
import { toPgVector } from './vectorUtils.js';

export function isEvidenceRagEnabled() {
  return process.env.USE_EVIDENCE_RAG === 'true';
}

/** Peso por nivel de calidad para el ranking futuro (documentado; ajustable). */
export const EVIDENCE_LEVEL_WEIGHT = { A: 1.0, B: 0.85, C: 0.6, D: 0.3 };

/**
 * Búsqueda vectorial en chunks revisados (coseno <=>, índice HNSW).
 * Filtros opcionales por sujeto: solo chunks vinculados a claims de esos ingredientes/formulaciones/productos.
 */
export async function searchEvidenceChunks(
  queryEmbedding,
  { topK = 8, ingredientIds = null, formulationIds = null, productIds = null, sourceIds = null, client = pool } = {}
) {
  const hasSubject = [ingredientIds, formulationIds, productIds].some((a) => Array.isArray(a) && a.length);
  const { rows } = await client.query(
    `SELECT v.chunk_id, v.source_id, v.source_key, v.source_category, v.title, v.doi, v.pmid, v.url, v.year,
            v.evidence_level, v.section, v.heading, v.page, v.content,
            1 - (v.embedding <=> $1::vector) AS similarity
     FROM v_retrievable_evidence_chunks v
     WHERE ($2::int[] IS NULL OR v.source_id = ANY($2::int[]))
       AND (NOT $3::boolean OR EXISTS (
             SELECT 1 FROM evidence_claim_chunks cc JOIN evidence_claims c ON c.claim_id = cc.claim_id
             WHERE cc.chunk_id = v.chunk_id AND c.review_status = 'reviewed'
               AND (c.ingredient_id = ANY($4::int[]) OR c.formulation_id = ANY($5::int[]) OR c.product_id = ANY($6::int[]))))
     ORDER BY v.embedding <=> $1::vector, v.chunk_id
     LIMIT $7`,
    [toPgVector(queryEmbedding), sourceIds && sourceIds.length ? sourceIds : null, hasSubject,
     ingredientIds || [], formulationIds || [], productIds || [], Math.max(1, topK)]
  );
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

/** Claims revisados (de fuentes revisadas) para ingredientes / formulaciones / productos. */
export async function getClaimsForSubjects(
  { ingredientIds = [], formulationIds = [], productIds = [], timing = null, client = pool } = {}
) {
  const { rows } = await client.query(
    `SELECT * FROM v_retrievable_claims
     WHERE (ingredient_id = ANY($1::int[]) OR formulation_id = ANY($2::int[]) OR product_id = ANY($3::int[]))
       AND ($4::text IS NULL OR $4 = ANY(timing_context))
     ORDER BY source_evidence_level NULLS LAST, claim_id`,
    [ingredientIds, formulationIds, productIds, timing]
  );
  return rows;
}

/**
 * Respaldo del momento de consumo (regla documentada para la fase futura):
 * solo timing_evidence_strength strong/moderate, claim revisado de fuente revisada no-fabricante,
 * eficacia/guía con resultado positivo o mixto y momento concreto. limited / not_assessed NO habilitan.
 */
export async function getTimingSupport({ ingredientIds = [], formulationIds = [], productIds = [], client = pool } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM v_claim_timing_support
     WHERE (ingredient_id = ANY($1::int[]) OR formulation_id = ANY($2::int[]) OR product_id = ANY($3::int[]))
     ORDER BY claim_id, timing`,
    [ingredientIds, formulationIds, productIds]
  );
  return rows;
}

/** Fuente completa para trazabilidad (DOI/PMID/URL) de un claim o chunk. */
export async function getProvenance({ claimId = null, chunkId = null, client = pool } = {}) {
  const { rows } = await client.query(
    `SELECT s.source_id, s.source_key, s.title, s.doi, s.pmid, s.url, s.year, s.source_category, s.review_status
     FROM evidence_sources s
     WHERE s.source_id = COALESCE(
       (SELECT source_id FROM evidence_claims WHERE claim_id = $1),
       (SELECT source_id FROM evidence_chunks WHERE chunk_id = $2))`,
    [claimId, chunkId]
  );
  return rows[0] || null;
}
