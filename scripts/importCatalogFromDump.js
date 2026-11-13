// scripts/importCatalogFromDump.js — Importa el catálogo de productos desde el dump MariaDB a PostgreSQL.
//
// Uso:
//   node scripts/importCatalogFromDump.js --dry-run            -> solo cuenta filas del dump
//   node scripts/importCatalogFromDump.js --confirm            -> importa en DATABASE_URL (UPSERT idempotente)
//   node scripts/importCatalogFromDump.js --confirm --with-embeddings
//   node scripts/importCatalogFromDump.js --dump=ruta/al/dump.sql --confirm
//
// Solo tablas de catálogo (sin datos personales). Usuarios: ver scripts/importUsersSanitized.js.
import { readDump, DEFAULT_DUMP_PATH } from './lib/mariadbDump.js';
import { CATALOG_TABLES, importCatalog } from './lib/catalogImport.js';
import { migrateEmbeddingsFromDump } from './lib/embeddingImport.js';
import { connect, flagValue, hasFlag } from './lib/cli.js';

async function main() {
  const dumpPath = flagValue('dump', DEFAULT_DUMP_PATH);
  const dump = readDump(dumpPath);
  console.log(`📄 Dump: ${dumpPath}`);

  if (hasFlag('dry-run')) {
    for (const { table } of CATALOG_TABLES) {
      console.log(`  ${table}: ${dump[table]?.rows.length || 0} filas`);
    }
    console.log(`  product_embeddings: ${dump.product_embeddings?.rows.length || 0} filas`);
    console.log('ℹ️  --dry-run: no se escribió nada.');
    return;
  }

  const client = await connect({ writes: true });
  try {
    console.log('📦 Importando catálogo...');
    await importCatalog(client, { dump });
    if (hasFlag('with-embeddings')) {
      console.log('🧭 Migrando embeddings válidos del dump...');
      await migrateEmbeddingsFromDump(client, { dump });
    }
    console.log('✅ Importación completada. Ejecuta scripts/verifyIntegrity.js para comprobarla.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌ Error importando catálogo:', error.message);
  process.exit(1);
});
