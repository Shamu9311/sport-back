// scripts/lib/catalogImport.js — Importa el catálogo (sin datos personales) desde el dump MariaDB a PostgreSQL.
import { readDump } from './mariadbDump.js';

/** Tablas de catálogo en orden de dependencias (FK). Ninguna contiene datos personales. */
export const CATALOG_TABLES = [
  { table: 'product_categories', pk: ['category_id'], identity: 'category_id' },
  { table: 'product_types', pk: ['type_id'], identity: 'type_id' },
  { table: 'products', pk: ['product_id'], identity: 'product_id', booleans: ['is_active'] },
  { table: 'product_attributes', pk: ['attribute_id'], identity: 'attribute_id' },
  { table: 'product_attributes_mapping', pk: ['product_id', 'attribute_id'] },
  { table: 'flavors', pk: ['flavor_id'], identity: 'flavor_id' },
  { table: 'product_flavors', pk: ['product_id', 'flavor_id'] },
  { table: 'product_nutrition', pk: ['nutrition_id'], identity: 'nutrition_id' },
];

function toBoolean(value) {
  if (value === null || value === undefined) return null;
  return Number(value) !== 0;
}

/** Inserta filas con UPSERT por clave primaria (idempotente). Devuelve el número de filas procesadas. */
export async function upsertRows(client, { table, pk, booleans = [] }, rows) {
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  const updatable = columns.filter((c) => !pk.includes(c));
  const BATCH = 200;
  let count = 0;

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((col) => {
        let value = row[col];
        if (booleans.includes(col)) value = toBoolean(value);
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const conflict =
      updatable.length > 0
        ? `DO UPDATE SET ${updatable.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
        : 'DO NOTHING';
    const sql =
      `INSERT INTO ${table} (${columns.join(', ')}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(', ')} ` +
      `ON CONFLICT (${pk.join(', ')}) ${conflict}`;
    await client.query(sql, params);
    count += batch.length;
  }
  return count;
}

/** Ajusta la secuencia IDENTITY al máximo id existente (necesario tras insertar ids explícitos). */
export async function syncIdentity(client, table, column) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, $2),
                   GREATEST((SELECT COALESCE(MAX(${column}), 0) FROM ${table}), 1),
                   (SELECT COUNT(*) > 0 FROM ${table}))`,
    [`public.${table}`, column]
  );
}

/** Marca de las migraciones que corrigen datos del catálogo y deben reaplicarse tras reimportar el dump. */
export const CATALOG_CORRECTION_MARKER = '@catalog-correction';

/**
 * Reaplica las migraciones marcadas como corrección de catálogo (idempotentes). El dump MariaDB es anterior
 * a esas correcciones: sin este paso, reimportarlo las desharía (p. ej. el tipo de los productos 17 y 18).
 */
export async function applyCatalogCorrections(client, { log = console.log } = {}) {
  const { listMigrationFiles } = await import('../../db/migrate.js');
  const corrections = listMigrationFiles().filter((m) => m.sql.includes(CATALOG_CORRECTION_MARKER));
  for (const m of corrections) {
    await client.query(m.sql);
    log(`  ✔ corrección de catálogo reaplicada: ${m.name}`);
  }
  return corrections.map((m) => m.name);
}

/**
 * Importa todas las tablas de catálogo dentro de una transacción.
 * @returns {Promise<Record<string, number>>} filas por tabla
 */
export async function importCatalog(client, { dumpPath, dump = readDump(dumpPath), log = console.log } = {}) {
  const summary = {};
  await client.query('BEGIN');
  try {
    for (const spec of CATALOG_TABLES) {
      const rows = dump[spec.table]?.rows || [];
      summary[spec.table] = await upsertRows(client, spec, rows);
      if (spec.identity) await syncIdentity(client, spec.table, spec.identity);
      log(`  ✔ ${spec.table}: ${summary[spec.table]} filas`);
    }
    summary.catalog_corrections = await applyCatalogCorrections(client, { log });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  return summary;
}
