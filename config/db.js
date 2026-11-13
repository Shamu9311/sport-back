// config/db.js — Conexión a PostgreSQL (Supabase) con node-postgres.
import pg from 'pg';
import { buildPoolConfig } from './dbConfig.js';

export { parseDatabaseUrl, resolveDatabaseUrl, buildPoolConfig } from './dbConfig.js';

const { Pool } = pg;

export const createConnection = (url) => {
  const newPool = new Pool(buildPoolConfig(url));
  newPool.on('error', (err) => {
    console.error('❌ Error inesperado en cliente PostgreSQL inactivo:', err.message);
  });
  return newPool;
};

const pool = createConnection();

/** Atajo: ejecuta una consulta parametrizada ($1, $2, ...) y devuelve el resultado de pg. */
export const query = (text, params) => pool.query(text, params);

/** Ejecuta `fn(client)` dentro de una transacción (BEGIN/COMMIT/ROLLBACK). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { pool };
export default pool;

// Test de conexión automático (fuera de los tests para no ensuciar la salida)
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Conexión a PostgreSQL exitosa');
    } catch (err) {
      console.error('❌ Error de conexión a PostgreSQL:', err.message);
    }
  })();
}
