import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../config/db.js';
import { computeNormalization, applyNormalization } from '../../scripts/lib/ingredientStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLES_DIR = path.resolve(__dirname, '../../data/evidence/examples');
export const EXAMPLE_FILES = {
  scientific: path.join(EXAMPLES_DIR, 'example-scientific-crossover-trial.json'),
  guideline: path.join(EXAMPLES_DIR, 'example-guideline-issn-caffeine.json'),
  manufacturer: path.join(EXAMPLES_DIR, 'example-manufacturer-beta-fuel-gel.json'),
};

export function loadExample(kind) {
  return JSON.parse(fs.readFileSync(EXAMPLE_FILES[kind], 'utf8'));
}

/** Copia temporal de un manifiesto (para variantes en las pruebas). */
export function writeTempManifest(manifest, name) {
  const dir = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'evidence-tests');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return file;
}

/** Vacía evidencia e ingredientes (solo BD de test). */
export async function resetEvidenceAndIngredients() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Solo en NODE_ENV=test');
  await pool.query(`TRUNCATE evidence_ingest_runs, product_evidence, evidence_claim_chunks, evidence_claims,
                    evidence_chunks, evidence_sources, ingredient_mapping_review, product_formulations,
                    product_ingredients, formulation_ingredients, formulations, ingredients RESTART IDENTITY CASCADE`);
}

/** Normaliza ingredientes del catálogo dentro de una transacción. */
export async function normalizeCatalog() {
  const client = await pool.connect();
  try {
    const normalization = await computeNormalization(client);
    await client.query('BEGIN');
    const counts = await applyNormalization(client, normalization);
    await client.query('COMMIT');
    return { normalization, counts };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ingredientId(code) {
  const { rows } = await pool.query('SELECT ingredient_id FROM ingredients WHERE code = $1', [code]);
  return rows[0]?.ingredient_id;
}

export const silent = () => {};
