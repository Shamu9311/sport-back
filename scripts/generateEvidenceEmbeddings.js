// scripts/generateEvidenceEmbeddings.js — Embeddings de evidence_chunks (gemini-embedding-001, 768, RETRIEVAL_DOCUMENT).
//
// Uso:
//   node scripts/generateEvidenceEmbeddings.js --dry-run            -> lista los chunks pendientes
//   node scripts/generateEvidenceEmbeddings.js --confirm            -> genera solo los pendientes
//   node scripts/generateEvidenceEmbeddings.js --source=<source_key> --confirm
// Pendiente = sin vector, contenido cambiado (content_hash ≠ embedded_content_hash) u otro modelo.
// Las fuentes 'retired' se omiten. Idempotente.
import { connect, flagValue, hasFlag } from './lib/cli.js';
import { findPendingChunks, embedPendingChunks } from './lib/evidenceEmbeddings.js';

async function main() {
  const dryRun = hasFlag('dry-run');
  const client = await connect({ writes: !dryRun });
  try {
    let sourceIds = null;
    const sourceKey = flagValue('source');
    if (sourceKey) {
      const { rows } = await client.query('SELECT source_id FROM evidence_sources WHERE source_key = $1', [sourceKey]);
      if (!rows.length) throw new Error(`Fuente inexistente: ${sourceKey}`);
      sourceIds = [rows[0].source_id];
    }
    if (dryRun) {
      const pending = await findPendingChunks(client, { sourceIds });
      console.log(`ℹ️  --dry-run: ${pending.length} chunks pendientes de embedding.`);
      pending.forEach((c) => console.log(`  - ${c.source_key}#${c.chunk_id}`));
      return;
    }
    const summary = await embedPendingChunks(client, { sourceIds, delayMs: 300, log: console.log });
    console.log(`\n🎉 Pendientes: ${summary.pending} · generados: ${summary.embedded} · errores: ${summary.failed.length}`);
    if (summary.failed.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌ Error generando embeddings de evidencia:', error.message);
  process.exit(1);
});
