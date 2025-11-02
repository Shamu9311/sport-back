-- Script para implementar sistema de feedback de productos
USE sport;

-- Tabla para almacenar feedback de usuarios sobre productos
CREATE TABLE IF NOT EXISTS `user_product_feedback` (
  `feedback_id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `feedback` ENUM('positivo', 'negativo') NOT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`feedback_id`),
  UNIQUE KEY `unique_user_product` (`user_id`, `product_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`product_id`) ON DELETE CASCADE,
  KEY `idx_user_feedback` (`user_id`, `feedback`),
  KEY `idx_product_feedback` (`product_id`, `feedback`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Verificar que se creó correctamente
DESCRIBE user_product_feedback;

-- Ver si hay datos
SELECT COUNT(*) as total FROM user_product_feedback;

