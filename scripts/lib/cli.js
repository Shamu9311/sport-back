// scripts/lib/cli.js — Utilidades comunes de los scripts de migración.
import pg from 'pg';
import { buildPoolConfig, resolveDatabaseUrl, parseDatabaseUrl } from '../../config/dbConfig.js';

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function flagValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

/** Descripción segura (sin contraseña) de la BD destino. */
export function describeTarget() {
  const { host, port, database, user } = parseDatabaseUrl(resolveDatabaseUrl());
  const env = process.env.NODE_ENV === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  return `${env} → ${user}@${host}:${port}/${database}`;
}

/**
 * Conecta un cliente pg a la BD resuelta (DATABASE_URL o TEST_DATABASE_URL si NODE_ENV=test).
 * Para escribir en la BD principal exige --confirm; sin él, el script solo informa.
 */
export async function connect({ writes = false } = {}) {
  const target = describeTarget();
  console.log(`🎯 Destino: ${target}`);
  if (writes && process.env.NODE_ENV !== 'test' && !hasFlag('confirm') && !hasFlag('dry-run')) {
    console.log('ℹ️  Este script escribe en la base de datos principal. Repite con --confirm para ejecutarlo,');
    console.log('   o con --dry-run para ver qué haría sin escribir.');
    process.exit(2);
  }
  const client = new pg.Client(buildPoolConfig());
  await client.connect();
  await client.query('SET search_path TO public, extensions');
  return client;
}
