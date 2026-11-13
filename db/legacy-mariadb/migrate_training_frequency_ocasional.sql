-- Migración: corregir valor ENUM training_frequency de 'ocacional' a 'ocasional'
-- Ejecutar una sola vez en bases de datos existentes.

ALTER TABLE `user_profiles`
  MODIFY COLUMN `training_frequency` ENUM('1-2','3-4','5+','ocacional','ocasional') DEFAULT NULL;

UPDATE `user_profiles` SET `training_frequency` = 'ocasional' WHERE `training_frequency` = 'ocacional';

ALTER TABLE `user_profiles`
  MODIFY COLUMN `training_frequency` ENUM('1-2','3-4','5+','ocasional') DEFAULT NULL;
