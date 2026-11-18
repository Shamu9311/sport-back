# Base de datos — PostgreSQL (Supabase) + pgvector

El backend usa PostgreSQL mediante `pg` y lo conecta con `DATABASE_URL`. La autenticación sigue siendo JWT propia: no se usa Supabase Auth y el frontend no accede a Supabase.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | BD principal (Supabase → **Connect → Session pooler**, puerto 5432) |
| `DATABASE_SSL` | `true` en Supabase |
| `DATABASE_SSL_CA` | (opcional) ruta al certificado CA de Supabase para verificar el servidor |
| `TEST_DATABASE_URL` | BD **solo para tests**. Los tests borran sus tablas. Debe ser distinta de `DATABASE_URL` |

Con `NODE_ENV=test`, el backend y los scripts usan **siempre** `TEST_DATABASE_URL`.

## Migraciones (`db/migrations`)

| Archivo | Contenido |
|---|---|
| `001_extensions.sql` | `vector` (pgvector) en el esquema `extensions` y trigger `set_updated_at()` |
| `002_core_schema.sql` | 15 tablas del esquema MariaDB (ENUM → CHECK, tinyint → boolean, IDENTITY, FKs, índices) |
| `003_product_embeddings_vector.sql` | `product_embeddings.embedding vector(768)` + índice HNSW coseno |
| `004_evidence_layer.sql` | `evidence_sources`, `evidence_chunks` (vector 768), `evidence_claims`, `product_evidence` |
| `005_security_rls.sql` | RLS activado y privilegios revocados a `anon`/`authenticated` (Data API de Supabase) |
| `006_embedding_model_default.sql` | Modelo por defecto de embeddings: `gemini-embedding-001` |
| `007_unaccent_search.sql` | Extensión `unaccent` para buscar productos sin distinguir tildes |
| `008_ingredients.sql` | `ingredients`, `formulations`, `formulation_ingredients`, `product_ingredients`, `product_formulations` e `ingredient_mapping_review` (`other_components` se conserva) |
| `009_evidence_model_v2.sql` | Recrea la capa de evidencia: `evidence_sources` (con `source_category`), `evidence_chunks` (`vector(768)`), `evidence_claims` (`timing_context[]`), `evidence_claim_chunks`, `product_evidence` (`relation_type`), `evidence_ingest_runs` y los triggers de reglas |
| `010_evidence_views_and_rls.sql` | Vistas `v_retrievable_evidence_chunks`, `v_retrievable_claims`, `v_claim_timing_support` y `v_product_evidence_derived`; RLS en las tablas nuevas |
| `011_usage_instruction_general.sql` | Contrato v1.1: `usage_instruction` sin sujeto solo en fuentes `scientific_evidence`/`official_guideline`; en el fabricante exige producto y/o ingrediente (CHECK `evidence_claims_subject` + trigger `evidence_claims_rules`) |
| `012_vitamin_b_codes.sql` | Catálogo de ingredientes v1.1: `vitamin_b6`, `folic_acid`, `vitamin_b12`, `biotin`, `pantothenic_acid` (mismos valores que `data/evidence/ingredients.json`) |

La capa de evidencia **no participa en las recomendaciones** (`USE_EVIDENCE_RAG=false`). El contrato, la escala de niveles A–D, las reglas de timing y el flujo de curación están en [`data/evidence/README.md`](../data/evidence/README.md).

```bash
node scripts/normalizeIngredients.js --dry-run | --confirm
node scripts/ingestEvidence.js <archivo|carpeta> --dry-run | --confirm
node scripts/generateEvidenceEmbeddings.js --dry-run | --confirm
```

Las migraciones aplicadas se registran en `schema_migrations` junto con su checksum. **No edites una migración ya aplicada**: crea una nueva (`006_...sql`).

## Puesta en marcha (BD principal)

```bash
node db/migrate.js --status
node db/migrate.js
node scripts/importCatalogFromDump.js --dry-run
node scripts/importCatalogFromDump.js --confirm --with-embeddings
node scripts/verifyIntegrity.js
```

- Los scripts que escriben en la BD principal exigen `--confirm`. Con `--dry-run` solo muestran lo que harían.
- `scripts/migrateEmbeddingsFromDump.js --confirm [--regenerate]` migra los embeddings JSON válidos del dump. Con `--regenerate`, los inválidos o faltantes se regeneran con Gemini.
- `scripts/generateProductEmbeddings.js --missing|--all|--product=ID --confirm` (re)genera embeddings con Gemini.
- `scripts/importUsersSanitized.js --confirm` es **opcional**: importa el historial de usuarios **anonimizado** (sin correos, contraseñas ni notas reales).

El dump MariaDB original y los scripts SQL antiguos están en `db/legacy-mariadb/`.

## Tests

```bash
node test/db/setupTestDb.js                 # recrea tablas en TEST_DATABASE_URL + catálogo + embeddings
node node_modules/vitest/vitest.mjs run     # suite completa (equivale a npm test)
```

## Búsqueda vectorial

`services/vectorSearchService.js` → `findSimilarProducts()` ordena por `embedding <=> $1::vector` (distancia coseno) dentro de PostgreSQL. La similitud se calcula como `1 - distancia`. Los productos inactivos y los excluidos por feedback negativo se filtran en la misma consulta.
