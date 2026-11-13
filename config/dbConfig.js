// config/dbConfig.js — Resolución de la configuración de PostgreSQL (sin efectos secundarios).
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

/**
 * Convierte una URL postgres en config de pg. Tolera contraseñas sin codificar
 * (p. ej. con "?", "/", "&" o "@"): toma como separador el ÚLTIMO "@" antes del host.
 */
export function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL no está definida.');
  }
  const trimmed = url.trim().replace(/^["']|["']$/g, '');
  const match = trimmed.match(/^postgres(?:ql)?:\/\/(.*)@([^@/]+)\/([^?]*)(?:\?(.*))?$/);
  if (!match) {
    throw new Error('DATABASE_URL tiene un formato inválido (esperado postgresql://user:pass@host:port/db).');
  }
  const [, credentials, hostPort, database, query] = match;
  const sep = credentials.indexOf(':');
  const rawUser = sep >= 0 ? credentials.slice(0, sep) : credentials;
  const rawPassword = sep >= 0 ? credentials.slice(sep + 1) : '';
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const [host, port] = hostPort.split(':');
  const params = new URLSearchParams(query || '');
  return {
    user: safeDecode(rawUser),
    password: safeDecode(rawPassword),
    host,
    port: port ? parseInt(port, 10) : 5432,
    database: safeDecode(database || 'postgres'),
    sslmode: params.get('sslmode'),
  };
}

function resolveSsl(sslmode) {
  const flag = String(process.env.DATABASE_SSL ?? '').trim().toLowerCase();
  const wantsSsl = flag === 'true' || flag === '1' || (sslmode && sslmode !== 'disable');
  if (!wantsSsl || flag === 'false') return false;

  const caPath = process.env.DATABASE_SSL_CA;
  if (caPath) {
    const resolved = path.resolve(process.cwd(), caPath);
    if (fs.existsSync(resolved)) {
      return { ca: fs.readFileSync(resolved, 'utf8'), rejectUnauthorized: true };
    }
    console.warn(`[db] DATABASE_SSL_CA no encontrado (${caPath}); se usa SSL sin verificar certificado.`);
  }
  return { rejectUnauthorized: false };
}

/** URL efectiva: en NODE_ENV=test se usa SIEMPRE TEST_DATABASE_URL (nunca la BD principal). */
export function resolveDatabaseUrl() {
  if (process.env.NODE_ENV === 'test') {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL es obligatorio cuando NODE_ENV=test.');
    }
    if (process.env.DATABASE_URL && testUrl.trim() === process.env.DATABASE_URL.trim()) {
      throw new Error('TEST_DATABASE_URL no puede ser igual a DATABASE_URL.');
    }
    return testUrl;
  }
  return process.env.DATABASE_URL;
}

export function buildPoolConfig(url = resolveDatabaseUrl()) {
  const parsed = parseDatabaseUrl(url);
  return {
    user: parsed.user,
    password: parsed.password,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    ssl: resolveSsl(parsed.sslmode),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // pgvector vive en el esquema "extensions" (Supabase): se fija al abrir la conexión para resolver tipo y operadores.
    options: '-c search_path=public,extensions',
  };
}

