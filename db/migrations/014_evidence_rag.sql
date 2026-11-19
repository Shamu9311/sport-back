-- 014_evidence_rag.sql — Evidence RAG: clasificación funcional versionada, trazabilidad y estado de generación.
--
-- La clasificación funcional NO es evidencia y NO habilita timing: solo indica para qué está diseñado cada
-- tipo de producto (fueling / hydration / recovery / no_fueling) y qué nutrientes puede aportar en qué fases.
-- El timing siempre procede de un claim científico o de guía revisado (v_claim_timing_support).

-- ------------------------------------------------------------------ Clasificación funcional (por product_type)
CREATE TABLE functional_role_nutrients (
  role                   text NOT NULL CHECK (role IN ('fueling','hydration','recovery','no_fueling')),
  nutrient               text NOT NULL CHECK (nutrient ~ '^[a-z0-9_]+$'),
  timings                text[] NOT NULL CHECK (cardinality(timings) > 0
                           AND timings <@ ARRAY['pre','during','post','daily_chronic']::text[]),
  classification_version text NOT NULL,
  rationale              text NOT NULL,
  PRIMARY KEY (role, nutrient)
);
COMMENT ON TABLE functional_role_nutrients IS
  'Fases en que un rol funcional puede aportar un nutriente. Restringe; nunca habilita timing por sí sola.';

CREATE TABLE product_type_functional_roles (
  type_id                integer PRIMARY KEY REFERENCES product_types (type_id) ON DELETE CASCADE,
  roles                  text[] NOT NULL CHECK (cardinality(roles) > 0
                           AND roles <@ ARRAY['fueling','hydration','recovery','no_fueling']::text[]),
  nutrients              text[] NOT NULL DEFAULT '{}',
  classification_version text NOT NULL,
  rationale              text NOT NULL,
  reviewed_by            text,
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_type_roles_no_fueling CHECK (
    NOT ('no_fueling' = ANY (roles)) OR (cardinality(roles) = 1 AND cardinality(nutrients) = 0))
);
COMMENT ON TABLE product_type_functional_roles IS
  'Clasificación funcional versionada por tipo de producto (no por nombre). No es evidencia de eficacia.';

INSERT INTO functional_role_nutrients (role, nutrient, timings, classification_version, rationale) VALUES
  ('fueling',   'carbohydrate', '{pre,during}',      'v1.0', 'Productos de combustible: carbohidrato antes y durante el ejercicio.'),
  ('fueling',   'caffeine',     '{pre,during}',      'v1.0', 'Cafeína incluida en productos de combustible.'),
  ('fueling',   'sodium',       '{pre,during}',      'v1.0', 'Electrolitos incluidos en productos de combustible.'),
  ('hydration', 'sodium',       '{pre,during,post}', 'v1.0', 'Reposición de líquidos y electrolitos.'),
  ('hydration', 'caffeine',     '{pre,during}',      'v1.0', 'Cafeína incluida en productos de hidratación.'),
  ('recovery',  'protein',      '{pre,post}',        'v1.0', 'Proteína alrededor del ejercicio; no es un producto de combustible.'),
  ('recovery',  'carbohydrate', '{post}',            'v1.0', 'Carbohidrato de recuperación; no se usa como combustible durante el ejercicio.');

INSERT INTO product_type_functional_roles (type_id, roles, nutrients, classification_version, rationale, reviewed_by, reviewed_at)
SELECT v.type_id, v.roles, v.nutrients, 'v1.0', v.rationale, 'Samuel Pérez Arpi', '2026-11-18T00:00:00Z'
  FROM (VALUES
    (1,  '{fueling}'::text[],           '{carbohydrate}'::text[],          'Gel energético isotónico.'),
    (2,  '{fueling}',                   '{carbohydrate,caffeine}',         'Gel energético con cafeína.'),
    (3,  '{fueling}',                   '{carbohydrate,sodium}',           'Gel energético con electrolitos.'),
    (4,  '{fueling}',                   '{carbohydrate}',                  'Gel energético BETA Fuel.'),
    (5,  '{fueling}',                   '{carbohydrate,caffeine}',         'Gel BETA Fuel con cafeína; restricciones de uso según su ficha oficial.'),
    (6,  '{fueling}',                   '{carbohydrate}',                  'Barrita energética horneada.'),
    (7,  '{fueling}',                   '{carbohydrate}',                  'Barrita energética.'),
    (8,  '{fueling,hydration}',         '{carbohydrate,sodium}',           'Bebida en polvo con carbohidrato y electrolitos.'),
    (9,  '{hydration}',                 '{sodium}',                        'Tableta de electrolitos.'),
    (10, '{hydration}',                 '{sodium,caffeine}',               'Tableta de electrolitos con cafeína.'),
    (11, '{recovery}',                  '{protein,carbohydrate}',          'Bebida de recuperación.'),
    (12, '{recovery}',                  '{protein,carbohydrate}',          'Bebida de recuperación.'),
    (13, '{recovery}',                  '{protein,carbohydrate}',          'Barrita de proteína.'),
    (14, '{no_fueling}',                '{}',                              'Aminoácidos; no es producto de combustible ni de hidratación.'),
    (15, '{no_fueling}',                '{}',                              'Multivitamínico.'),
    (16, '{no_fueling}',                '{}',                              'Tableta de vitaminas y minerales; no es producto de combustible.'),
    (17, '{fueling}',                   '{carbohydrate}',                  'BETA Fuel 80, polvo para bebida de carbohidrato.'),
    (18, '{fueling}',                   '{carbohydrate}',                  'BETA Fuel Energy Chews.')
  ) AS v(type_id, roles, nutrients, rationale)
 WHERE EXISTS (SELECT 1 FROM product_types pt WHERE pt.type_id = v.type_id);

-- ------------------------------------------------------------------ Recomendaciones: modo y trazabilidad
ALTER TABLE recommendations
  ADD COLUMN evidence_mode  text NOT NULL DEFAULT 'legacy' CHECK (evidence_mode IN ('legacy','evidence_rag')),
  ADD COLUMN cadence_status text CHECK (cadence_status IN ('cadence_verified','cadence_unverified')),
  ADD COLUMN evidence_note  text;

ALTER TABLE training_sessions
  ADD COLUMN recommendation_status text CHECK (recommendation_status IN ('pending','ready','none','failed')),
  ADD COLUMN recommendation_note   text;

CREATE TABLE recommendation_evidence (
  recommendation_evidence_id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  recommendation_id integer NOT NULL REFERENCES recommendations (recommendation_id) ON DELETE CASCADE,
  source_id         integer NOT NULL REFERENCES evidence_sources (source_id),
  claim_id          integer REFERENCES evidence_claims (claim_id),
  chunk_id          integer REFERENCES evidence_chunks (chunk_id),
  relation_type     text NOT NULL CHECK (relation_type IN ('direct_product','formulation','ingredient','manufacturer_specification')),
  role              text NOT NULL CHECK (role IN ('supports','caveat','dose_reference','usage_constraint')),
  similarity        numeric(6,5),
  score             numeric(8,5),
  rank              smallint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_evidence_unique UNIQUE NULLS NOT DISTINCT (recommendation_id, claim_id, chunk_id, role)
);
CREATE INDEX recommendation_evidence_rec_idx ON recommendation_evidence (recommendation_id);
COMMENT ON TABLE recommendation_evidence IS
  'Qué evidencia respaldó cada recomendación (Evidence RAG). El fabricante solo aparece como usage_constraint.';

-- Reglas: claim/chunk de la misma fuente; el fabricante nunca respalda eficacia ni fija dosis
CREATE OR REPLACE FUNCTION public.recommendation_evidence_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_category text;
BEGIN
  SELECT source_category INTO v_category FROM evidence_sources WHERE source_id = NEW.source_id;
  IF NEW.claim_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM evidence_claims WHERE claim_id = NEW.claim_id AND source_id = NEW.source_id) THEN
    RAISE EXCEPTION 'El claim % no pertenece a la fuente %', NEW.claim_id, NEW.source_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.chunk_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM evidence_chunks WHERE chunk_id = NEW.chunk_id AND source_id = NEW.source_id) THEN
    RAISE EXCEPTION 'El chunk % no pertenece a la fuente %', NEW.chunk_id, NEW.source_id USING ERRCODE = 'check_violation';
  END IF;
  IF (v_category = 'manufacturer_specification') <> (NEW.role = 'usage_constraint') THEN
    RAISE EXCEPTION 'La ficha del fabricante solo puede registrarse como usage_constraint (y usage_constraint solo para el fabricante)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.role = 'usage_constraint') <> (NEW.relation_type = 'manufacturer_specification') THEN
    RAISE EXCEPTION 'usage_constraint exige relation_type manufacturer_specification' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recommendation_evidence_rules_trg BEFORE INSERT OR UPDATE ON recommendation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.recommendation_evidence_rules();

-- ------------------------------------------------------------------ Seguridad (mismo patrón que 005/010)
ALTER TABLE functional_role_nutrients ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_type_functional_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_evidence ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON functional_role_nutrients, product_type_functional_roles, recommendation_evidence FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON functional_role_nutrients, product_type_functional_roles, recommendation_evidence FROM authenticated';
  END IF;
END
$$;
