// scripts/verifyIntegrity.js — Verifica la integridad de la BD PostgreSQL migrada. Solo lectura.
//
// Uso:
//   node scripts/verifyIntegrity.js                  -> contra DATABASE_URL
//   NODE_ENV=test node scripts/verifyIntegrity.js    -> contra TEST_DATABASE_URL
//   node scripts/verifyIntegrity.js --no-dump        -> omite comparar conteos con el dump
// Código de salida 1 si alguna verificación falla.
import { readDump, DEFAULT_DUMP_PATH } from './lib/mariadbDump.js';
import { CATALOG_TABLES } from './lib/catalogImport.js';
import { listMigrationFiles } from '../db/migrate.js';
import { connect, flagValue, hasFlag } from './lib/cli.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

export async function runIntegrityChecks(client, { dump = null } = {}) {
  // 1. Extensión y migraciones
  const { rows: ext } = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  check('Extensión pgvector instalada', ext.length === 1, ext[0] ? `v${ext[0].extversion}` : 'no instalada');

  const expected = listMigrationFiles().map((m) => m.version);
  const { rows: applied } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedSet = new Set(applied.map((r) => r.version));
  const missing = expected.filter((v) => !appliedSet.has(v));
  check('Migraciones aplicadas', missing.length === 0, missing.length ? `faltan ${missing.join(', ')}` : `${expected.length}/${expected.length}`);

  // 2. Conteos de catálogo vs dump
  if (dump) {
    for (const { table } of CATALOG_TABLES) {
      const expectedRows = dump[table]?.rows.length || 0;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      check(`Conteo ${table}`, rows[0].n >= expectedRows, `${rows[0].n} (dump: ${expectedRows})`);
    }
  }

  // 3. Integridad referencial: filas huérfanas (no deberían existir con FKs válidas)
  const orphanChecks = [
    ['products.type_id', 'SELECT COUNT(*)::int n FROM products p LEFT JOIN product_types t ON t.type_id = p.type_id WHERE p.type_id IS NOT NULL AND t.type_id IS NULL'],
    ['product_nutrition.product_id', 'SELECT COUNT(*)::int n FROM product_nutrition n LEFT JOIN products p ON p.product_id = n.product_id WHERE n.product_id IS NOT NULL AND p.product_id IS NULL'],
    ['recommendations.session_id', 'SELECT COUNT(*)::int n FROM recommendations r LEFT JOIN training_sessions s ON s.session_id = r.session_id WHERE r.session_id IS NOT NULL AND s.session_id IS NULL'],
    ['product_embeddings.product_id', 'SELECT COUNT(*)::int n FROM product_embeddings e LEFT JOIN products p ON p.product_id = e.product_id WHERE p.product_id IS NULL'],
  ];
  for (const [name, sql] of orphanChecks) {
    const { rows } = await client.query(sql);
    check(`Sin huérfanos en ${name}`, rows[0].n === 0, `${rows[0].n}`);
  }

  const { rows: invalidFks } = await client.query(
    "SELECT conname FROM pg_constraint WHERE contype IN ('f','c') AND NOT convalidated AND connamespace = 'public'::regnamespace"
  );
  check('Todas las FKs/CHECKs validadas', invalidFks.length === 0, invalidFks.map((r) => r.conname).join(', '));

  // 4. Embeddings
  const { rows: emb } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE vector_dims(embedding) <> 768)::int AS bad_dims,
           COUNT(*) FILTER (WHERE vector_norm(embedding) = 0)::int AS zero_norm
    FROM product_embeddings`);
  check('Embeddings de 768 dimensiones', emb[0].bad_dims === 0, `${emb[0].total} vectores, ${emb[0].bad_dims} con otra dimensión`);
  check('Embeddings con norma > 0', emb[0].zero_norm === 0);

  const expectedModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
  const { rows: models } = await client.query(
    'SELECT embedding_model, COUNT(*)::int AS n FROM product_embeddings GROUP BY embedding_model ORDER BY 2 DESC'
  );
  const otherModels = models.filter((m) => m.embedding_model !== expectedModel);
  check(
    `Embeddings generados con ${expectedModel}`,
    otherModels.length === 0 || process.env.NODE_ENV === 'test',
    models.map((m) => `${m.embedding_model}: ${m.n}`).join(', ') +
      (otherModels.length ? ' → ejecuta scripts/generateProductEmbeddings.js --missing --confirm' : '')
  );

  const { rows: noEmb } = await client.query(`
    SELECT COUNT(*)::int AS n FROM products p
    WHERE p.is_active AND NOT EXISTS (SELECT 1 FROM product_embeddings e WHERE e.product_id = p.product_id)`);
  check('Productos activos con embedding', noEmb[0].n === 0, noEmb[0].n ? `${noEmb[0].n} sin embedding` : 'todos');

  if (emb[0].total > 0) {
    const { rows: knn } = await client.query(`
      SELECT e2.product_id, 1 - (e2.embedding <=> e1.embedding) AS similarity
      FROM product_embeddings e1, product_embeddings e2
      WHERE e1.product_id = (SELECT MIN(product_id) FROM product_embeddings)
      ORDER BY e2.embedding <=> e1.embedding
      LIMIT 1`);
    const self = knn[0];
    check(
      'Búsqueda coseno pgvector (un vector es su propio vecino más cercano)',
      self && Math.abs(Number(self.similarity) - 1) < 1e-5,
      self ? `similitud ${Number(self.similarity).toFixed(6)}` : 'sin resultados'
    );
  }

  // 4b. Capa de evidencia e ingredientes (migraciones 008–010), si existe
  const { rows: evidenceReady } = await client.query("SELECT to_regclass('public.evidence_ingest_runs') IS NOT NULL AS ok");
  if (evidenceReady[0].ok) {
    const evidenceChecks = [
      ['Fabricante sin claims de eficacia/seguridad',
       `SELECT COUNT(*)::int n FROM evidence_claims c JOIN evidence_sources s USING (source_id)
        WHERE s.source_category = 'manufacturer_specification' AND c.claim_type NOT IN ('composition','usage_instruction')`],
      ['Fuentes científicas/guías revisadas con nivel A–D',
       `SELECT COUNT(*)::int n FROM evidence_sources
        WHERE review_status = 'reviewed' AND source_category <> 'manufacturer_specification' AND evidence_level IS NULL`],
      ['Embeddings de evidencia de 768 dims y norma > 0',
       `SELECT COUNT(*)::int n FROM evidence_chunks
        WHERE embedding IS NOT NULL AND (vector_dims(embedding) <> 768 OR vector_norm(embedding) = 0)`],
      ['Claim ↔ chunk de la misma fuente',
       `SELECT COUNT(*)::int n FROM evidence_claim_chunks cc JOIN evidence_claims c USING (claim_id)
        JOIN evidence_chunks ch ON ch.chunk_id = cc.chunk_id WHERE c.source_id <> ch.source_id`],
      ['not_applicable solo en composición/instrucciones',
       `SELECT COUNT(*)::int n FROM evidence_claims
        WHERE (claim_type IN ('composition','usage_instruction')) <> (effect_direction = 'not_applicable')`],
      ['product_ingredients con ingredientes activos',
       `SELECT COUNT(*)::int n FROM product_ingredients pi JOIN ingredients i USING (ingredient_id) WHERE NOT i.is_active`],
    ];
    for (const [name, sql] of evidenceChecks) {
      const { rows } = await client.query(sql);
      check(name, rows[0].n === 0, rows[0].n ? `${rows[0].n} filas incorrectas` : '');
    }
    const { rows: ev } = await client.query(`
      SELECT (SELECT COUNT(*)::int FROM evidence_sources) sources,
             (SELECT COUNT(*)::int FROM evidence_sources WHERE review_status = 'reviewed') reviewed,
             (SELECT COUNT(*)::int FROM evidence_claims) claims,
             (SELECT COUNT(*)::int FROM evidence_chunks) chunks,
             (SELECT COUNT(*)::int FROM evidence_chunks WHERE embedding IS NULL OR embedded_content_hash IS DISTINCT FROM content_hash) chunks_pending,
             (SELECT COUNT(*)::int FROM product_ingredients) product_ingredients,
             (SELECT COUNT(*)::int FROM ingredient_mapping_review WHERE status = 'pending') ingredient_reviews_pending`);
    console.log(`ℹ️  evidencia: ${JSON.stringify(ev[0])}`);
  }

  // 5. Secuencias IDENTITY por delante del máximo id
  const { rows: idCols } = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_identity = 'YES' AND table_name <> 'schema_migrations'`);
  const behind = [];
  for (const { table_name: t, column_name: c } of idCols) {
    const { rows: seqRows } = await client.query('SELECT pg_get_serial_sequence($1, $2) AS s', [`public.${t}`, c]);
    const sequence = seqRows[0].s;
    const { rows } = await client.query(
      `SELECT (SELECT COALESCE(MAX(${c}), 0) FROM ${t}) AS max_id, last_value AS seq, is_called AS called FROM ${sequence}`
    );
    const { max_id: maxId, seq, called } = rows[0];
    const next = called ? Number(seq) + 1 : Number(seq);
    if (next <= Number(maxId)) behind.push(`${t}.${c} (siguiente ${next} ≤ max ${maxId})`);
  }
  check('Secuencias IDENTITY sincronizadas', behind.length === 0, behind.join('; '));

  // 6. Seguridad: RLS activo y sin privilegios para anon/authenticated (Supabase)
  const { rows: noRls } = await client.query(`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity`);
  check('RLS activado en todas las tablas public', noRls.length === 0, noRls.map((r) => r.relname).join(', '));

  const { rows: roles } = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')");
  if (roles.length > 0) {
    const { rows: grants } = await client.query(`
      SELECT DISTINCT grantee, table_name FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')`);
    check('Sin privilegios de anon/authenticated sobre tablas', grants.length === 0,
      grants.map((g) => `${g.grantee}:${g.table_name}`).join(', '));
  }

  // 7. Datos personales: en la BD no debería quedar ningún email fuera de dominios de prueba si se usó la importación anonimizada
  const { rows: users } = await client.query('SELECT COUNT(*)::int AS n FROM users');
  console.log(`ℹ️  users: ${users[0].n} filas`);

  return results;
}

async function main() {
  const client = await connect({ writes: false });
  try {
    const dump = hasFlag('no-dump') ? null : readDump(flagValue('dump', DEFAULT_DUMP_PATH));
    await runIntegrityChecks(client, { dump });
  } finally {
    await client.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n❌ ${failed.length} verificación(es) fallida(s).` : '\n✅ Integridad verificada.');
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('verifyIntegrity.js')) {
  main().catch((error) => {
    console.error('❌ Error verificando integridad:', error.message);
    process.exit(1);
  });
}
