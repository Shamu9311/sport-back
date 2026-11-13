-- 007_unaccent_search.sql
-- Búsqueda de productos sin distinguir tildes ("cafeína" = "cafeina"). MariaDB con utf8mb4_general_ci
-- ya ignoraba mayúsculas y tildes; PostgreSQL necesita la extensión unaccent.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
