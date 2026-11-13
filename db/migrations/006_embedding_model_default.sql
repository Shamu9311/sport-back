-- 006_embedding_model_default.sql
-- text-embedding-004 fue retirado de la API de Gemini. El modelo vigente es gemini-embedding-001
-- con outputDimensionality = 768 (compatible con vector(768)).
ALTER TABLE product_embeddings ALTER COLUMN embedding_model SET DEFAULT 'gemini-embedding-001';
ALTER TABLE evidence_chunks ALTER COLUMN embedding_model SET DEFAULT 'gemini-embedding-001';

COMMENT ON COLUMN product_embeddings.embedding_model IS
  'Modelo que generó el vector. Solo son comparables vectores del mismo modelo (ver EMBEDDING_MODEL).';
