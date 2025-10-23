-- Script para agregar campos de timing de consumo a la tabla recommendations
-- Ejecutar este script en la base de datos MySQL

USE sport;

-- Agregar nuevas columnas a la tabla recommendations
ALTER TABLE recommendations 
ADD COLUMN consumption_timing ENUM('antes', 'durante', 'despues', 'diario') DEFAULT NULL AFTER feedback_notes,
ADD COLUMN timing_minutes INT DEFAULT NULL COMMENT 'Minutos antes/después del entrenamiento' AFTER consumption_timing,
ADD COLUMN recommended_quantity VARCHAR(100) DEFAULT NULL COMMENT 'Cantidad recomendada (ej: 1 gel cada 30 min)' AFTER timing_minutes,
ADD COLUMN consumption_instructions TEXT DEFAULT NULL COMMENT 'Instrucciones adicionales de consumo' AFTER recommended_quantity;

-- Verificar que las columnas se agregaron correctamente
DESCRIBE recommendations;

-- Opcional: Ver recomendaciones existentes con los nuevos campos
SELECT 
  recommendation_id,
  user_id,
  session_id,
  product_id,
  consumption_timing,
  timing_minutes,
  recommended_quantity,
  consumption_instructions
FROM recommendations
LIMIT 5;

