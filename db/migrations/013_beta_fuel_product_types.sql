-- 013_beta_fuel_product_types.sql — Corrección de catálogo: tipos propios para BETA Fuel 80 y BETA Fuel Chews
-- @catalog-correction  (idempotente: importCatalog la vuelve a aplicar tras reimportar el catálogo del dump)
--
-- Los productos 17 (BETA Fuel 80, polvo para bebida: un sobre en 600 ml según la ficha oficial de SiS) y
-- 18 (BETA Fuel Energy Chews) estaban clasificados como "BETA Fuel Gels" (type_id 4). Los tipos 17 y 18 ya
-- existían sin productos; el 17 tenía además una errata ("ETA FUEL 80 ..."). No se añade ninguna cadencia
-- ni cantidad: solo se corrige la forma del producto.

UPDATE product_types SET name = 'BETA Fuel 80 Drink Powder'
 WHERE type_id = 17 AND name IS DISTINCT FROM 'BETA Fuel 80 Drink Powder';

UPDATE product_types SET name = 'BETA Fuel Energy Chews'
 WHERE type_id = 18 AND name IS DISTINCT FROM 'BETA Fuel Energy Chews';

UPDATE products SET type_id = 17
 WHERE product_id = 17 AND name = 'BETA FUEL 80 Dual Source Energy Drink' AND type_id IS DISTINCT FROM 17;

UPDATE products SET type_id = 18
 WHERE product_id = 18 AND name = 'BETA FUEL ENERGY CHEWS' AND type_id IS DISTINCT FROM 18;
