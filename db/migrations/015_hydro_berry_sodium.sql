-- 015_hydro_berry_sodium.sql — Corrección de catálogo: sodio de HYDRO Tablet Berry (producto 36)
-- @catalog-correction  (idempotente: importCatalog la vuelve a aplicar tras reimportar el catálogo del dump)
--
-- El catálogo guardaba 870 mg de "sodio" por porción (500 ml), que corresponde a la SAL declarada (0.87 g).
-- La ficha oficial de SiS GO Hydro Berry (sis-go-hydro-current, revisada por Samuel Pérez Arpi el 2026-11-19)
-- declara 345 mg de sodio por tableta disuelta en 500 ml (0.87 g de sal ≈ 345 mg × 2.5).
-- Solo se corrige el producto 36: el 35 (Lemon) y los HYDRO + Caffeine (37, 38) no tienen ficha revisada.

UPDATE product_nutrition SET sodium_mg = 345
 WHERE product_id = 36 AND sodium_mg = 870;
