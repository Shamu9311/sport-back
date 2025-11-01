-- Tabla para almacenar embeddings de productos
CREATE TABLE IF NOT EXISTS `product_embeddings` (
  `embedding_id` INT NOT NULL AUTO_INCREMENT,
  `product_id` INT NOT NULL,
  `embedding` JSON NOT NULL COMMENT 'Vector de embeddings (array de floats - 768 dims para Gemini)',
  `embedding_model` VARCHAR(50) DEFAULT 'text-embedding-004',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`embedding_id`),
  UNIQUE KEY `product_id` (`product_id`),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Índice para búsquedas más rápidas
CREATE INDEX IF NOT EXISTS idx_product_embeddings ON product_embeddings(product_id);