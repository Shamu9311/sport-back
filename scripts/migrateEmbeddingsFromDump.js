// scripts/migrateEmbeddingsFromDump.js — Migra los embeddings JSON del dump MariaDB a vector(768).
//
// Uso:
//   node scripts/migrateEmbeddingsFromDump.js --dry-run              -> valida sin escribir
//   node scripts/migrateEmbeddingsFromDump.js --confirm              -> migra los válidos
//   node scripts/migrateEmbeddingsFromDump.js --confirm --regenerate -> además regenera con Gemini
//                                                                       los inválidos o faltantes
// Requisito: el catálogo ya importado (scripts/importCatalogFromDump.js).
import { readDump, DEFAULT_DUMP_PATH } from './lib/mariadbDump.js';
import { migrateEmbeddingsFromDump, validateEmbedding } from './lib/embeddingImport.js';
import { connect, flagValue, hasFlag } from './lib/cli.js';
import { regenerateEmbeddings } from './lib/productEmbeddings.js';

async function main() {
  const dumpPath = flagValue('dump', DEFAULT_DUMP_PATH);
  const dump = readDump(dumpPath);
  const rows = dump.product_embeddings?.rows || [];
  console.log(`📄 Dump: ${dumpPath} — ${rows.length} embeddings`);

  if (hasFlag('dry-run')) {
    const invalid = [];
    const dims = new Map();
    for (const row of rows) {
      const check = validateEmbedding(row.embedding);
      if (check.ok) dims.set(check.vector.length, (dims.get(check.vector.length) || 0) + 1);
      else invalid.push({ product_id: row.product_id, reason: check.reason });
    }
    console.log(`  válidos: ${rows.length - invalid.length} (dims: ${JSON.stringify(Object.fromEntries(dims))})`);
    console.log(`  inválidos: ${invalid.length}${invalid.length ? ' ' + JSON.stringify(invalid) : ''}`);
    console.log('ℹ️  --dry-run: no se escribió nada.');
    return;
  }

  const client = await connect({ writes: true });
  try {
    const result = await migrateEmbeddingsFromDump(client, { dump });
    const pending = [...result.invalid.map((i) => i.product_id), ...result.missing].filter((id) =>
      Number.isInteger(id)
    );
    if (pending.length > 0 && hasFlag('regenerate')) {
      console.log(`🤖 Regenerando con Gemini ${pending.length} embeddings...`);
      await regenerateEmbeddings(client, { productIds: pending });
    } else if (pending.length > 0) {
      console.log('ℹ️  Hay productos sin embedding válido. Usa --regenerate o scripts/generateProductEmbeddings.js --missing.');
    }
    console.log('✅ Migración de embeddings completada.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌ Error migrando embeddings:', error.message);
  process.exit(1);
});
