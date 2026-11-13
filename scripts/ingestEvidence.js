// scripts/ingestEvidence.js — Ingesta de manifiestos de evidencia científica (uno por fuente).
//
// Uso:
//   node scripts/ingestEvidence.js data/evidence/sources/ --dry-run      -> valida y simula (ROLLBACK), no escribe
//   node scripts/ingestEvidence.js data/evidence/sources/x.json --confirm -> escribe en DATABASE_URL
//   NODE_ENV=test node scripts/ingestEvidence.js data/evidence/examples/ --confirm
//   Opciones: --skip-embeddings (no genera vectores tras la ingesta), --allow-examples (permite source_key "example-*")
//
// Cada manifiesto se procesa en su propia transacción: un error en un archivo no afecta a los demás.
// Ejecutar dos veces el mismo archivo no duplica nada (idempotente).
import fs from 'fs';
import path from 'path';
import { connect, hasFlag } from './lib/cli.js';
import { readManifest, ManifestValidationError } from './lib/evidenceManifest.js';
import { ingestManifest, loadReferenceContext, IngestError } from './lib/evidenceIngest.js';
import { embedPendingChunks } from './lib/evidenceEmbeddings.js';

export function listManifestFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(target, f));
}

async function recordRun(client, entry) {
  await client.query(
    `INSERT INTO evidence_ingest_runs (file_path, file_sha256, source_key, mode, status, finished_at, summary, errors)
     VALUES ($1, $2, $3, $4, $5, now(), $6::jsonb, $7::jsonb)`,
    [entry.file, entry.sha256, entry.source_key, entry.mode, entry.status,
     JSON.stringify(entry.summary || {}), JSON.stringify(entry.errors || [])]
  );
}

/**
 * Procesa una lista de archivos. Devuelve un resultado por archivo.
 * @param {import('pg').Client} client
 */
export async function ingestFiles(client, files, { confirm = false, embed = true, allowExamples = false, log = console.log } = {}) {
  const results = [];
  const ctx = await loadReferenceContext(client);
  for (const file of files) {
    const entry = { file, mode: confirm ? 'confirm' : 'dry_run', status: 'failed', errors: [] };
    let manifest;
    try {
      ({ manifest, sha256: entry.sha256 } = readManifest(file));
      entry.source_key = manifest?.source?.source_key || null;
    } catch (error) {
      entry.errors.push(`JSON inválido: ${error.message}`);
      results.push(entry);
      log(`❌ ${file}: JSON inválido (${error.message})`);
      continue;
    }

    try {
      await client.query('BEGIN');
      const { sourceId, summary } = await ingestManifest(client, manifest, { sha256: entry.sha256, allowExamples, ctx });
      entry.summary = summary;
      entry.source_id = sourceId;
      if (confirm) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      entry.status = 'success';
      log(`${confirm ? '✅' : '🔎'} ${path.basename(file)} → ${JSON.stringify(summary)}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      entry.errors = error instanceof ManifestValidationError ? error.errors : [error.message];
      log(`❌ ${path.basename(file)}:\n   - ${entry.errors.join('\n   - ')}`);
    }

    if (confirm && entry.status === 'success' && embed) {
      try {
        entry.embeddings = await embedPendingChunks(client, { sourceIds: [entry.source_id] });
        if (entry.embeddings.failed.length) {
          entry.errors.push(...entry.embeddings.failed.map((f) => `embedding chunk ${f.chunk_id}: ${f.error}`));
        }
      } catch (error) {
        // Los datos quedan guardados; los embeddings se pueden reintentar con generateEvidenceEmbeddings.js
        entry.errors.push(`embeddings: ${error.message}`);
      }
    }

    if (confirm) {
      await recordRun(client, { ...entry, summary: { ...entry.summary, embeddings: entry.embeddings } }).catch((e) =>
        log(`⚠️ No se pudo registrar la ejecución: ${e.message}`)
      );
    }
    results.push(entry);
  }
  return results;
}

async function main() {
  const target = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('Uso: node scripts/ingestEvidence.js <archivo.json | carpeta> --dry-run | --confirm');
    process.exit(2);
  }
  const confirm = hasFlag('confirm');
  if (!confirm && !hasFlag('dry-run')) {
    console.error('Indica --dry-run (simulación) o --confirm (escritura).');
    process.exit(2);
  }
  const files = listManifestFiles(target);
  const client = await connect({ writes: confirm });
  try {
    const results = await ingestFiles(client, files, {
      confirm,
      embed: !hasFlag('skip-embeddings'),
      allowExamples: process.env.NODE_ENV === 'test' || hasFlag('allow-examples'),
    });
    const failed = results.filter((r) => r.status !== 'success');
    console.log(`\n${confirm ? 'Ingesta' : 'Simulación (--dry-run, sin escrituras)'}: ${results.length - failed.length} correctos, ${failed.length} con errores.`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('ingestEvidence.js')) {
  main().catch((error) => {
    console.error('❌ Error en la ingesta:', error.message);
    process.exit(1);
  });
}

export { IngestError };
