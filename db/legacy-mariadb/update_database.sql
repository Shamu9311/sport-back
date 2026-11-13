-- Script para actualizar la estructura de la base de datos

-- 1. Verificar y actualizar la tabla users
-- Asegurarse de que la tabla users tenga la estructura correcta
ALTER TABLE users 
MODIFY COLUMN username VARCHAR(255) NOT NULL,
MODIFY COLUMN email VARCHAR(255) NOT NULL UNIQUE,
MODIFY COLUMN password VARCHAR(255) NOT NULL;

-- 2. Verificar y actualizar la tabla user_profiles
-- Primero verificamos si existe la columna goal y la eliminamos si es necesario
SET @exist_goal := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'user_profiles' 
                    AND COLUMN_NAME = 'goal');

SET @sql_drop_goal = IF(@exist_goal > 0, 'ALTER TABLE user_profiles DROP COLUMN goal', 'SELECT "La columna goal no existe"');
PREPARE stmt FROM @sql_drop_goal;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ahora verificamos y añadimos las columnas necesarias si no existen
-- training_frequency
SET @exist_training_frequency := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                                 WHERE TABLE_SCHEMA = DATABASE() 
                                 AND TABLE_NAME = 'user_profiles' 
                                 AND COLUMN_NAME = 'training_frequency');

SET @sql_add_training_frequency = IF(@exist_training_frequency = 0, 
                                   'ALTER TABLE user_profiles ADD COLUMN training_frequency VARCHAR(50) NULL', 
                                   'SELECT "La columna training_frequency ya existe"');
PREPARE stmt FROM @sql_add_training_frequency;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- primary_goal
SET @exist_primary_goal := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                           WHERE TABLE_SCHEMA = DATABASE() 
                           AND TABLE_NAME = 'user_profiles' 
                           AND COLUMN_NAME = 'primary_goal');

SET @sql_add_primary_goal = IF(@exist_primary_goal = 0, 
                             'ALTER TABLE user_profiles ADD COLUMN primary_goal VARCHAR(50) NULL', 
                             'SELECT "La columna primary_goal ya existe"');
PREPARE stmt FROM @sql_add_primary_goal;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- sweat_level
SET @exist_sweat_level := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                          WHERE TABLE_SCHEMA = DATABASE() 
                          AND TABLE_NAME = 'user_profiles' 
                          AND COLUMN_NAME = 'sweat_level');

SET @sql_add_sweat_level = IF(@exist_sweat_level = 0, 
                            'ALTER TABLE user_profiles ADD COLUMN sweat_level VARCHAR(50) NULL', 
                            'SELECT "La columna sweat_level ya existe"');
PREPARE stmt FROM @sql_add_sweat_level;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- caffeine_tolerance
SET @exist_caffeine_tolerance := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                                 WHERE TABLE_SCHEMA = DATABASE() 
                                 AND TABLE_NAME = 'user_profiles' 
                                 AND COLUMN_NAME = 'caffeine_tolerance');

SET @sql_add_caffeine_tolerance = IF(@exist_caffeine_tolerance = 0, 
                                   'ALTER TABLE user_profiles ADD COLUMN caffeine_tolerance VARCHAR(50) NULL', 
                                   'SELECT "La columna caffeine_tolerance ya existe"');
PREPARE stmt FROM @sql_add_caffeine_tolerance;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- dietary_restrictions
SET @exist_dietary_restrictions := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                                   WHERE TABLE_SCHEMA = DATABASE() 
                                   AND TABLE_NAME = 'user_profiles' 
                                   AND COLUMN_NAME = 'dietary_restrictions');

SET @sql_add_dietary_restrictions = IF(@exist_dietary_restrictions = 0, 
                                     'ALTER TABLE user_profiles ADD COLUMN dietary_restrictions VARCHAR(50) NULL', 
                                     'SELECT "La columna dietary_restrictions ya existe"');
PREPARE stmt FROM @sql_add_dietary_restrictions;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Mostrar la estructura actual de las tablas para verificar
SHOW COLUMNS FROM users;
SHOW COLUMNS FROM user_profiles;
