-- 010_evidence_views_and_rls.sql
-- Vistas de solo lectura para la FUTURA recuperación de evidencia (no usadas por el recomendador actual)
-- y seguridad (RLS + REVOKE) de las tablas nuevas.

-- Chunks recuperables: solo fuentes revisadas y con embedding (excluye draft y retired)
CREATE VIEW v_retrievable_evidence_chunks AS
SELECT ch.chunk_id, ch.source_id, ch.chunk_key, ch.chunk_index, ch.section, ch.heading, ch.page, ch.paragraph,
       ch.content, ch.content_kind, ch.embedding, ch.embedding_model,
       s.source_key, s.source_type, s.source_category, s.title, s.doi, s.pmid, s.url, s.year, s.evidence_level
FROM evidence_chunks ch
JOIN evidence_sources s ON s.source_id = ch.source_id
WHERE s.review_status = 'reviewed'
  AND ch.embedding IS NOT NULL
  AND ch.embedded_content_hash = ch.content_hash;   -- vector vigente para el contenido actual

-- Claims recuperables: claim revisado de fuente revisada
CREATE VIEW v_retrievable_claims AS
SELECT c.*, s.source_key, s.source_type, s.source_category, s.title, s.doi, s.pmid, s.url, s.year,
       s.evidence_level AS source_evidence_level
FROM evidence_claims c
JOIN evidence_sources s ON s.source_id = c.source_id
WHERE c.review_status = 'reviewed' AND s.review_status = 'reviewed';

-- Respaldo del momento de consumo por claim (documenta la regla futura; NO la aplica ningún servicio todavía).
-- can_justify_timing = true solo si:
--   * timing_evidence_strength IN ('strong','moderate')  (limited / not_assessed se conservan pero no habilitan)
--   * claim de eficacia o guía (dosis/timing) con resultado positivo o mixto
--   * la fuente NO es del fabricante (las instrucciones del fabricante no crean elegibilidad)
--   * el momento es concreto (pre/during/post/daily_chronic); flexible y not_specified no generan un momento
-- daily_chronic NUNCA se deriva de la categoría del catálogo: esta vista no consulta product_categories.
CREATE VIEW v_claim_timing_support AS
SELECT c.claim_id, c.source_id, c.claim_key, c.claim_type, c.ingredient_id, c.formulation_id, c.product_id,
       t.timing, c.timing_evidence_strength, c.effect_direction, c.conditions,
       c.review_status AS claim_review_status, s.review_status AS source_review_status, s.source_category,
       (c.review_status = 'reviewed' AND s.review_status = 'reviewed'
        AND c.timing_evidence_strength IN ('strong','moderate')
        AND c.claim_type IN ('efficacy','dosage_guideline','timing_guideline')
        AND c.effect_direction IN ('positive','mixed')
        AND s.source_category <> 'manufacturer_specification'
        AND t.timing IN ('pre','during','post','daily_chronic')) AS can_justify_timing
FROM evidence_claims c
JOIN evidence_sources s ON s.source_id = c.source_id
CROSS JOIN LATERAL unnest(c.timing_context) AS t(timing);

-- Relaciones producto ↔ evidencia: explícitas (curadas) + derivadas por ingrediente/formulación/estudio directo.
-- indirection_rank: 1 = estudio del producto, 2 = formulación, 3 = ingrediente, 4 = categoría, 5 = fabricante.
CREATE VIEW v_product_evidence_derived AS
SELECT pe.product_id, pe.source_id, pe.claim_id, pe.relation_type, 'explicit'::text AS origin,
       CASE pe.relation_type WHEN 'direct_product' THEN 1 WHEN 'formulation' THEN 2 WHEN 'ingredient' THEN 3
                             WHEN 'category' THEN 4 ELSE 5 END AS indirection_rank,
       pe.relevance, pe.rationale
FROM product_evidence pe
UNION ALL
SELECT c.product_id, c.source_id, c.claim_id,
       CASE WHEN s.source_category = 'manufacturer_specification' THEN 'manufacturer_specification' ELSE 'direct_product' END,
       'derived', CASE WHEN s.source_category = 'manufacturer_specification' THEN 5 ELSE 1 END, NULL::numeric,
       'Claim específico del producto'
FROM evidence_claims c JOIN evidence_sources s ON s.source_id = c.source_id
WHERE c.product_specific
UNION ALL
SELECT pf.product_id, c.source_id, c.claim_id, 'formulation', 'derived', 2, NULL::numeric,
       'El producto declara la formulación estudiada'
FROM product_formulations pf JOIN evidence_claims c ON c.formulation_id = pf.formulation_id
WHERE NOT c.product_specific
UNION ALL
SELECT pi.product_id, c.source_id, c.claim_id, 'ingredient', 'derived', 3, NULL::numeric,
       'El producto contiene el ingrediente estudiado'
FROM (SELECT DISTINCT product_id, ingredient_id FROM product_ingredients) pi
JOIN evidence_claims c ON c.ingredient_id = pi.ingredient_id
WHERE NOT c.product_specific;

-- ------------------------------------------------------------------ Seguridad (mismo patrón que 005)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
      'ingredients','formulations','formulation_ingredients','product_ingredients','product_formulations',
      'ingredient_mapping_review','evidence_sources','evidence_chunks','evidence_claims','evidence_claim_chunks',
      'product_evidence','evidence_ingest_runs') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
  END IF;
END
$$;
