-- 012_vitamin_b_codes.sql — Catálogo de ingredientes v1.1: 5 vitaminas del grupo B
-- Necesarias para desagregar "B-complex" (producto 47) con las cantidades de la ficha oficial de SiS
-- (Batch 2). Riboflavina (B2) ya existía en el catálogo (008/ingredients.json).
-- Los mismos valores están en data/evidence/ingredients.json (fuente de verdad del catálogo; un test
-- comprueba que coinciden). Idempotente: si el código ya existe no se modifica.

INSERT INTO ingredients (code, display_name, aliases, category, is_active) VALUES
  ('vitamin_b6',       'Vitamina B6 (piridoxina)',  ARRAY['vitamin b6','vitamina b6','pyridoxine','piridoxina'],                     'vitamin', true),
  ('folic_acid',       'Ácido fólico (B9)',         ARRAY['folic acid','ácido fólico','acido folico'],                             'vitamin', true),
  ('vitamin_b12',      'Vitamina B12 (cobalamina)', ARRAY['vitamin b12','vitamina b12','cobalamin','cobalamina'],                   'vitamin', true),
  ('biotin',           'Biotina (B7)',              ARRAY['biotin','biotina'],                                                     'vitamin', true),
  ('pantothenic_acid', 'Ácido pantoténico (B5)',    ARRAY['pantothenic acid','ácido pantoténico','acido pantotenico'],             'vitamin', true)
ON CONFLICT (code) DO NOTHING;
