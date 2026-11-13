-- Índice compuesto para consultas de recomendaciones guardadas por usuario
-- Ejecutar una sola vez en la base de datos sport

CREATE INDEX IF NOT EXISTS idx_rec_user_date
  ON recommendations (user_id, recommended_at DESC);

-- Índice para exclusiones de productos ya recomendados por usuario
CREATE INDEX IF NOT EXISTS idx_rec_user_product
  ON recommendations (user_id, product_id);
