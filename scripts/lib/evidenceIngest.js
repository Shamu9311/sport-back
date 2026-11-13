// scripts/lib/evidenceIngest.js — Ingesta idempotente de UN manifiesto de evidencia.
//
// El llamador abre la transacción (BEGIN) y decide COMMIT (--confirm) o ROLLBACK (--dry-run).
// El manifiesto es la fuente de verdad de SU fuente: chunks, claims y relaciones que ya no aparecen se eliminan.
// Nunca se tocan otras fuentes. Identidad de la fuente: source_key (+ DOI/PMID únicos).
import { prepareChunks } from './chunker.js';
import { validateManifest, ManifestValidationError } from './evidenceManifest.js';

const emptyCounts = () => ({ inserted: 0, updated: 0, unchanged: 0, deleted: 0 });

function tally(counts, rows) {
  if (rows.length === 0) counts.unchanged += 1;
  else if (rows[0].inserted) counts.inserted += 1;
  else counts.updated += 1;
}

/** Contexto de referencias desde la BD (para validar y resolver claves naturales). */
export async function loadReferenceContext(client) {
  // Secuencial: un mismo cliente pg no admite consultas concurrentes
  const ing = await client.query('SELECT ingredient_id, code FROM ingredients WHERE is_active');
  const form = await client.query('SELECT formulation_id, code FROM formulations');
  const prod = await client.query('SELECT product_id FROM products');
  const cat = await client.query('SELECT category_id FROM product_categories');
  return {
    ingredientIds: new Map(ing.rows.map((r) => [r.code, r.ingredient_id])),
    formulationIds: new Map(form.rows.map((r) => [r.code, r.formulation_id])),
    ingredientCodes: new Set(ing.rows.map((r) => r.code)),
    formulationCodes: new Set(form.rows.map((r) => r.code)),
    productIds: new Set(prod.rows.map((r) => r.product_id)),
    categoryIds: new Set(cat.rows.map((r) => r.category_id)),
  };
}

export class IngestError extends Error {}

/**
 * @param {import('pg').Client} client cliente dentro de una transacción
 * @param {object} manifest
 * @param {{ sha256?: string, allowExamples?: boolean, ctx?: object }} options
 */
export async function ingestManifest(client, manifest, { sha256 = null, allowExamples = false, ctx = null } = {}) {
  const refs = ctx || (await loadReferenceContext(client));
  const { warnings } = validateManifest(manifest, refs);
  const src = manifest.source;

  if (src.source_key.startsWith('example-') && !allowExamples) {
    throw new IngestError(
      `"${src.source_key}" es un manifiesto de ejemplo: solo se ingiere en la BD de test (o con --allow-examples).`
    );
  }

  // DOI / PMID ya usados por OTRA fuente → duplicado
  const { rows: clash } = await client.query(
    `SELECT source_key, doi, pmid FROM evidence_sources
     WHERE source_key <> $1 AND (($2::text IS NOT NULL AND lower(doi) = lower($2)) OR ($3::text IS NOT NULL AND pmid = $3))`,
    [src.source_key, src.doi || null, src.pmid || null]
  );
  if (clash.length) {
    throw new IngestError(
      `DOI/PMID duplicado: ya pertenece a la fuente "${clash[0].source_key}" (doi=${clash[0].doi}, pmid=${clash[0].pmid}).`
    );
  }

  const summary = {
    source_key: src.source_key,
    source: null,
    chunks: emptyCounts(),
    claims: emptyCounts(),
    claim_chunks: { linked: 0, unlinked: 0 },
    product_ingredients: emptyCounts(),
    relations: emptyCounts(),
    warnings,
  };

  // ---------------------------------------------------------------- Fuente
  const sourceCols = [
    'source_key', 'source_type', 'title', 'authors', 'organization', 'journal', 'year', 'publication_date',
    'accessed_date', 'doi', 'pmid', 'url', 'open_access', 'license', 'peer_reviewed', 'evidence_level',
    'evidence_level_rationale', 'funding', 'industry_funded', 'conflict_of_interest', 'review_status',
    'reviewed_by', 'reviewed_at', 'notes', 'language',
  ];
  const sourceValues = sourceCols.map((c) => {
    if (c === 'authors') return src.authors || [];
    if (c === 'review_status') return src.review_status || 'draft';
    if (c === 'language') return src.language || 'en';
    return src[c] ?? null;
  });
  const setCols = sourceCols.filter((c) => c !== 'source_key');
  const { rows: srcRows } = await client.query(
    `INSERT INTO evidence_sources (${sourceCols.join(', ')}, manifest_sha256)
     VALUES (${sourceCols.map((_, i) => `$${i + 1}`).join(', ')}, $${sourceCols.length + 1})
     ON CONFLICT (source_key) DO UPDATE SET ${setCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
       manifest_sha256 = EXCLUDED.manifest_sha256
     WHERE (${setCols.map((c) => `evidence_sources.${c}`).join(', ')})
           IS DISTINCT FROM (${setCols.map((c) => `EXCLUDED.${c}`).join(', ')})
     RETURNING source_id, (xmax = 0) AS inserted`,
    [...sourceValues, sha256]
  );
  let sourceId;
  if (srcRows.length) {
    sourceId = srcRows[0].source_id;
    summary.source = srcRows[0].inserted ? 'inserted' : 'updated';
  } else {
    const { rows } = await client.query('SELECT source_id FROM evidence_sources WHERE source_key = $1', [src.source_key]);
    sourceId = rows[0].source_id;
    summary.source = 'unchanged';
  }

  // ---------------------------------------------------------------- Chunks
  const { rows: chunkRows, keyMap } = prepareChunks(manifest.chunks || []);
  // UNIQUE (source_id, chunk_index) es DEFERRABLE: reordenar chunks no choca dentro de la transacción
  const chunkIds = new Map();
  for (const ch of chunkRows) {
    const { rows } = await client.query(
      `INSERT INTO evidence_chunks (source_id, chunk_key, chunk_index, section, heading, page, paragraph,
                                    content, content_kind, content_hash, token_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (source_id, chunk_key) DO UPDATE SET
         chunk_index = EXCLUDED.chunk_index, section = EXCLUDED.section, heading = EXCLUDED.heading,
         page = EXCLUDED.page, paragraph = EXCLUDED.paragraph, content = EXCLUDED.content,
         content_kind = EXCLUDED.content_kind, token_count = EXCLUDED.token_count,
         -- contenido cambiado → el vector deja de ser válido y se regenerará
         embedding = CASE WHEN evidence_chunks.content_hash = EXCLUDED.content_hash THEN evidence_chunks.embedding END,
         embedding_model = CASE WHEN evidence_chunks.content_hash = EXCLUDED.content_hash THEN evidence_chunks.embedding_model END,
         embedded_content_hash = CASE WHEN evidence_chunks.content_hash = EXCLUDED.content_hash THEN evidence_chunks.embedded_content_hash END,
         embedded_at = CASE WHEN evidence_chunks.content_hash = EXCLUDED.content_hash THEN evidence_chunks.embedded_at END,
         content_hash = EXCLUDED.content_hash
       RETURNING chunk_id, (xmax = 0) AS inserted,
         -- Las subconsultas de RETURNING ven el estado previo a la sentencia: permite contar "sin cambios"
         (SELECT row(c.section, c.heading, c.page, c.paragraph, c.content_kind, c.content_hash, c.chunk_index)
            IS NOT DISTINCT FROM row($4::text, $5::text, $6::varchar, $7::varchar, $9::text, $10::char(64), $3::int)
          FROM evidence_chunks c WHERE c.source_id = $1 AND c.chunk_key = $2) AS same_before`,
      [sourceId, ch.chunk_key, ch.chunk_index, ch.section, ch.heading, ch.page, ch.paragraph, ch.content,
       ch.content_kind, ch.content_hash, ch.token_count]
    );
    chunkIds.set(ch.chunk_key, rows[0].chunk_id);
    if (rows[0].inserted) summary.chunks.inserted += 1;
    else if (rows[0].same_before) summary.chunks.unchanged += 1;
    else summary.chunks.updated += 1;
  }
  const { rowCount: chunksDeleted } = await client.query(
    'DELETE FROM evidence_chunks WHERE source_id = $1 AND NOT (chunk_key = ANY($2::text[]))',
    [sourceId, [...chunkIds.keys()]]
  );
  summary.chunks.deleted = chunksDeleted;

  // ---------------------------------------------------------------- Claims
  const claimCols = [
    'claim_type', 'ingredient_id', 'ingredient_name_raw', 'formulation_id', 'product_specific', 'product_id',
    'population', 'sample_size', 'sex', 'training_status', 'sport', 'exercise_context', 'exercise_duration',
    'exercise_duration_min_minutes', 'exercise_duration_max_minutes', 'dose_text', 'dose_value', 'dose_value_max',
    'dose_unit', 'dose_relative', 'frequency', 'duration_protocol', 'timing_context', 'timing_details',
    'timing_evidence_strength', 'conditions', 'outcome', 'effect_direction', 'effect_size', 'effect_size_value',
    'effect_size_metric', 'statistical_significance', 'result_summary', 'practical_interpretation', 'limitations',
    'evidence_strength', 'conflict_of_interest_notes', 'review_status',
  ];
  const claimIds = new Map();
  for (const claim of manifest.claims || []) {
    const value = (c) => {
      switch (c) {
        case 'ingredient_id': return claim.ingredient ? refs.ingredientIds.get(claim.ingredient) : null;
        case 'formulation_id': return claim.formulation ? refs.formulationIds.get(claim.formulation) : null;
        case 'product_specific': return claim.product_specific ?? false;
        case 'timing_context': return claim.timing_context || ['not_specified'];
        case 'timing_evidence_strength': return claim.timing_evidence_strength || 'not_assessed';
        case 'conditions': return JSON.stringify(claim.conditions || {});
        case 'statistical_significance': return claim.statistical_significance || 'not_reported';
        case 'review_status': return claim.review_status || 'draft';
        default: return claim[c] ?? null;
      }
    };
    const params = [sourceId, claim.claim_key, ...claimCols.map(value)];
    const placeholders = claimCols.map((c, i) => `$${i + 3}${c === 'conditions' ? '::jsonb' : ''}`);
    const { rows } = await client.query(
      `INSERT INTO evidence_claims (source_id, claim_key, ${claimCols.join(', ')})
       VALUES ($1, $2, ${placeholders.join(', ')})
       ON CONFLICT (source_id, claim_key) DO UPDATE SET ${claimCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
       WHERE (${claimCols.map((c) => `evidence_claims.${c}`).join(', ')})
             IS DISTINCT FROM (${claimCols.map((c) => `EXCLUDED.${c}`).join(', ')})
       RETURNING claim_id, (xmax = 0) AS inserted`,
      params
    );
    tally(summary.claims, rows);
    const id = rows.length
      ? rows[0].claim_id
      : (await client.query('SELECT claim_id FROM evidence_claims WHERE source_id = $1 AND claim_key = $2',
          [sourceId, claim.claim_key])).rows[0].claim_id;
    claimIds.set(claim.claim_key, id);

    // Claim ↔ chunks (claves finales tras una posible división del chunk)
    const wanted = (claim.chunk_keys || []).flatMap((k) => keyMap.get(k) || []).map((k) => chunkIds.get(k));
    const { rows: current } = await client.query('SELECT chunk_id FROM evidence_claim_chunks WHERE claim_id = $1', [id]);
    const currentSet = new Set(current.map((r) => r.chunk_id));
    for (const chunkId of wanted) {
      if (!currentSet.has(chunkId)) {
        await client.query('INSERT INTO evidence_claim_chunks (claim_id, chunk_id) VALUES ($1, $2)', [id, chunkId]);
        summary.claim_chunks.linked += 1;
      }
    }
    const { rowCount: unlinked } = await client.query(
      'DELETE FROM evidence_claim_chunks WHERE claim_id = $1 AND NOT (chunk_id = ANY($2::int[]))',
      [id, wanted]
    );
    summary.claim_chunks.unlinked += unlinked;
  }
  const { rowCount: claimsDeleted } = await client.query(
    'DELETE FROM evidence_claims WHERE source_id = $1 AND NOT (claim_key = ANY($2::text[]))',
    [sourceId, [...claimIds.keys()]]
  );
  summary.claims.deleted = claimsDeleted;

  // ---------------------------------------------------------------- Composición declarada por el fabricante
  for (const pi of manifest.product_ingredients || []) {
    const { rows } = await client.query(
      `INSERT INTO product_ingredients (product_id, ingredient_id, amount, unit, basis, serving_description,
                                        form, notes, data_source, source_id, review_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manufacturer_specification', $9,
               CASE WHEN $10 = 'reviewed' THEN 'reviewed' ELSE 'auto_confident' END)
       ON CONFLICT (product_id, ingredient_id, basis) DO UPDATE SET
         amount = EXCLUDED.amount, unit = EXCLUDED.unit, serving_description = EXCLUDED.serving_description,
         form = EXCLUDED.form, notes = EXCLUDED.notes, data_source = EXCLUDED.data_source,
         source_id = EXCLUDED.source_id, review_status = EXCLUDED.review_status
       WHERE product_ingredients.data_source <> 'manual'
         AND (product_ingredients.amount, product_ingredients.unit, product_ingredients.serving_description,
              product_ingredients.form, product_ingredients.notes, product_ingredients.data_source,
              product_ingredients.source_id, product_ingredients.review_status)
             IS DISTINCT FROM (EXCLUDED.amount, EXCLUDED.unit, EXCLUDED.serving_description, EXCLUDED.form,
              EXCLUDED.notes, EXCLUDED.data_source, EXCLUDED.source_id, EXCLUDED.review_status)
       RETURNING (xmax = 0) AS inserted`,
      [pi.product_id, refs.ingredientIds.get(pi.ingredient), pi.amount ?? null, pi.amount == null ? null : pi.unit,
       pi.basis || 'per_serving', pi.serving_description || null, pi.form || null, pi.notes || null, sourceId,
       src.review_status || 'draft']
    );
    tally(summary.product_ingredients, rows);
  }

  // ---------------------------------------------------------------- Relaciones producto ↔ evidencia
  const keptRelations = [];
  for (const rel of manifest.product_relations || []) {
    const claimId = rel.claim_key ? claimIds.get(rel.claim_key) : null;
    const { rows } = await client.query(
      `INSERT INTO product_evidence (product_id, source_id, claim_id, relation_type, ingredient_id, formulation_id,
                                     category_id, relevance, rationale, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (product_id, source_id, COALESCE(claim_id, 0), relation_type) DO UPDATE SET
         ingredient_id = EXCLUDED.ingredient_id, formulation_id = EXCLUDED.formulation_id,
         category_id = EXCLUDED.category_id, relevance = EXCLUDED.relevance,
         rationale = EXCLUDED.rationale, notes = EXCLUDED.notes
       WHERE (product_evidence.ingredient_id, product_evidence.formulation_id, product_evidence.category_id,
              product_evidence.relevance, product_evidence.rationale, product_evidence.notes)
             IS DISTINCT FROM (EXCLUDED.ingredient_id, EXCLUDED.formulation_id, EXCLUDED.category_id,
              EXCLUDED.relevance, EXCLUDED.rationale, EXCLUDED.notes)
       RETURNING product_evidence_id, (xmax = 0) AS inserted`,
      [rel.product_id, sourceId, claimId, rel.relation_type,
       rel.ingredient ? refs.ingredientIds.get(rel.ingredient) : null,
       rel.formulation ? refs.formulationIds.get(rel.formulation) : null,
       rel.category_id ?? null, rel.relevance ?? null, rel.rationale, rel.notes ?? null]
    );
    tally(summary.relations, rows);
    keptRelations.push(`${rel.product_id}|${claimId ?? 0}|${rel.relation_type}`);
  }
  const { rows: existingRel } = await client.query(
    'SELECT product_evidence_id, product_id, COALESCE(claim_id, 0) AS claim_id, relation_type FROM product_evidence WHERE source_id = $1',
    [sourceId]
  );
  for (const r of existingRel) {
    if (!keptRelations.includes(`${r.product_id}|${r.claim_id}|${r.relation_type}`)) {
      await client.query('DELETE FROM product_evidence WHERE product_evidence_id = $1', [r.product_evidence_id]);
      summary.relations.deleted += 1;
    }
  }

  return { sourceId, summary };
}

export { ManifestValidationError };
