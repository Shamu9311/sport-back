// db/migrate.js — Runner de migraciones SQL versionadas.
// Uso:
//   node db/migrate.js            -> aplica migraciones pendientes sobre DATABASE_URL
//   node db/migrate.js --status   -> muestra estado sin aplicar nada
//   NODE_ENV=test node db/migrate.js -> usa TEST_DATABASE_URL
// Cada archivo se aplica en su propia transacción y se registra en schema_migrations con su checksum.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import pg from 'pg';
import { buildPoolConfig } from '../config/dbConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      return {
        version: file.slice(0, 3),
        name: file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version    varchar(10) PRIMARY KEY,
      name       text NOT NULL,
      checksum   char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
}

/**
 * Aplica migraciones pendientes usando un cliente pg ya conectado.
 * @returns {Promise<string[]>} nombres aplicados
 */
export async function runMigrations(client, { log = console.log, dryRun = false } = {}) {
  await client.query('SET search_path TO public, extensions');
  await ensureMigrationsTable(client);
  const { rows } = await client.query('SELECT version, checksum, name FROM public.schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r]));
  const done = [];

  for (const migration of listMigrationFiles()) {
    const previous = applied.get(migration.version);
    if (previous) {
      if (previous.checksum !== migration.checksum) {
        throw new Error(
          `La migración ${migration.name} ya fue aplicada con otro contenido (checksum distinto). ` +
            'No edites migraciones aplicadas: crea una nueva.'
        );
      }
      continue;
    }
    if (dryRun) {
      log(`⏳ Pendiente: ${migration.name}`);
      done.push(migration.name);
      continue;
    }
    log(`▶️  Aplicando ${migration.name}...`);
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum]
      );
      await client.query('COMMIT');
      done.push(migration.name);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Falló ${migration.name}: ${error.message}`);
    }
  }
  return done;
}

async function main() {
  const dryRun = process.argv.includes('--status');
  const client = new pg.Client(buildPoolConfig());
  await client.connect();
  try {
    const done = await runMigrations(client, { dryRun });
    if (done.length === 0) {
      console.log('✅ Esquema al día: no hay migraciones pendientes.');
    } else {
      console.log(`✅ ${dryRun ? 'Pendientes' : 'Aplicadas'}: ${done.length}`);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error('❌', error.message);
    process.exit(1);
  });
}
