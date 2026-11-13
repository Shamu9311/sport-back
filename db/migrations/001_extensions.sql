-- 001_extensions.sql
-- Extensiones requeridas. En Supabase, pgvector vive en el esquema "extensions"
-- (incluido en el search_path por defecto). En PostgreSQL local se crea el esquema si no existe.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Función genérica para emular "ON UPDATE CURRENT_TIMESTAMP" de MariaDB.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
