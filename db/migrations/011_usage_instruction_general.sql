-- 011_usage_instruction_general.sql — Contrato de evidencia v1.1
-- Un claim usage_instruction puede ser una orientación práctica GENERAL (sin ingrediente, formulación ni
-- producto) únicamente cuando la fuente es scientific_evidence u official_guideline.
-- En una manufacturer_specification, usage_instruction sigue exigiendo un sujeto concreto: producto y/o ingrediente.
-- Los demás tipos de claim (efficacy, safety, mechanism, composition) siguen exigiendo sujeto.

-- 1) CHECK por fila: usage_instruction pasa a estar exento del sujeto (como dosage/timing_guideline).
--    El CHECK no puede consultar la categoría de la fuente; esa parte la aplica el trigger (paso 2).
ALTER TABLE evidence_claims DROP CONSTRAINT evidence_claims_subject;
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_subject CHECK (
  ingredient_id IS NOT NULL OR formulation_id IS NOT NULL OR product_id IS NOT NULL
  OR claim_type IN ('dosage_guideline','timing_guideline','usage_instruction'));

-- 2) Regla entre tablas: según la categoría de la fuente.
CREATE OR REPLACE FUNCTION public.evidence_claims_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_category text;
BEGIN
  SELECT source_category INTO v_category FROM evidence_sources WHERE source_id = NEW.source_id;

  -- Una especificación del fabricante solo aporta composición e instrucciones (nunca eficacia/seguridad)
  IF v_category = 'manufacturer_specification'
     AND NEW.claim_type NOT IN ('composition','usage_instruction') THEN
    RAISE EXCEPTION 'Una especificación del fabricante no puede aportar claims de tipo % (solo composition/usage_instruction)', NEW.claim_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- v1.1: usage_instruction sin sujeto solo en scientific_evidence / official_guideline
  IF NEW.claim_type = 'usage_instruction' AND NEW.ingredient_id IS NULL AND NEW.formulation_id IS NULL
     AND NEW.product_id IS NULL AND v_category NOT IN ('scientific_evidence','official_guideline') THEN
    RAISE EXCEPTION 'Un usage_instruction sin ingrediente, formulación ni producto solo se admite en fuentes scientific_evidence u official_guideline (fuente: %)', v_category
      USING ERRCODE = 'check_violation';
  END IF;

  -- En el fabricante, la instrucción de uso debe referirse a un producto y/o ingrediente concreto
  IF v_category = 'manufacturer_specification' AND NEW.claim_type = 'usage_instruction'
     AND NEW.ingredient_id IS NULL AND NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'Un usage_instruction del fabricante debe indicar el producto y/o el ingrediente'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON CONSTRAINT evidence_claims_subject ON evidence_claims IS
  'Sujeto obligatorio salvo dosage_guideline, timing_guideline y usage_instruction; el trigger evidence_claims_rules '
  'limita usage_instruction sin sujeto a fuentes scientific_evidence/official_guideline (contrato v1.1).';
