// test/db/setupTestDb.js — (Re)crea la BD de pruebas en PostgreSQL (TEST_DATABASE_URL).
// 1. Elimina las tablas del esquema public de la BD de TEST (nunca toca DATABASE_URL).
// 2. Aplica las migraciones versionadas (db/migrations).
// 3. Importa el catálogo y los embeddings desde el dump MariaDB (sin datos de usuario).
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
process.env.NODE_ENV = 'test';

const { buildPoolConfig, parseDatabaseUrl } = await import('../../config/dbConfig.js');
const { runMigrations } = await import('../../db/migrate.js');
const { importCatalog } = await import('../../scripts/lib/catalogImport.js');
const { migrateEmbeddingsFromDump } = await import('../../scripts/lib/embeddingImport.js');
const { readDump } = await import('../../scripts/lib/mariadbDump.js');

/** Salvaguarda: exige una URL de test explícita y distinta de la principal. */
function assertSafeTestTarget() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL no está definida (.env.test).');
  const mainUrl = process.env.DATABASE_URL;
  if (mainUrl) {
    const a = parseDatabaseUrl(testUrl);
    const b = parseDatabaseUrl(mainUrl);
    if (a.host === b.host && a.user === b.user && a.database === b.database && a.port === b.port) {
      throw new Error('TEST_DATABASE_URL apunta a la misma base que DATABASE_URL. Abortando.');
    }
  }
  return parseDatabaseUrl(testUrl);
}

async function dropPublicObjects(client) {
  await client.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;
      DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
    END
    $$;
  `);
}

export async function setupTestDatabase({ log = console.log } = {}) {
  const target = assertSafeTestTarget();
  const client = new pg.Client(buildPoolConfig(process.env.TEST_DATABASE_URL));
  await client.connect();
  try {
    log(`🧪 BD de test: ${target.user}@${target.host}/${target.database}`);
    await dropPublicObjects(client);
    const applied = await runMigrations(client, { log: () => {} });
    log(`  ✔ migraciones aplicadas: ${applied.length}`);
    const dump = readDump();
    await importCatalog(client, { dump, log: () => {} });
    const { migrated } = await migrateEmbeddingsFromDump(client, { dump, log: () => {} });
    log(`  ✔ catálogo importado y ${migrated.length} embeddings vector(768)`);
  } finally {
    await client.end();
  }
  log('✅ Base de datos de test creada con catálogo');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  setupTestDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error configurando BD de test:', error.message);
      process.exit(1);
    });
}
