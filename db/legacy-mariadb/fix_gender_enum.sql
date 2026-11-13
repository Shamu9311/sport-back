-- Script para corregir el ENUM de activity_level que tiene un valor vacío
USE sport;

-- Verificar valores actuales
SELECT DISTINCT activity_level FROM user_profiles;

-- Opción 1: Modificar la tabla para eliminar el valor vacío
ALTER TABLE user_profiles 
MODIFY COLUMN activity_level ENUM('sedentario', 'moderado', 'activo', 'muy activo') DEFAULT 'moderado';

-- Opcional: Actualizar cualquier registro que tenga el valor vacío
UPDATE user_profiles 
SET activity_level = 'moderado' 
WHERE activity_level IS NULL OR activity_level = '';

-- Verificar que se corrigió
DESCRIBE user_profiles;
SELECT DISTINCT activity_level FROM user_profiles;

