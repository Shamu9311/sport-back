import pool from '../../config/db.js';

const USER_DATA_TABLES = [
  'user_product_feedback',
  'recommendations',
  'training_sessions',
  'user_profiles',
  'notification_preferences',
  'users',
];

const ALLOWED_TABLES = new Set([...USER_DATA_TABLES, 'products', 'product_embeddings', 'product_categories']);

export async function resetUserData() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetUserData solo puede ejecutarse con NODE_ENV=test.');
  }
  // TRUNCATE ... CASCADE reemplaza a SET FOREIGN_KEY_CHECKS = 0 de MariaDB
  await pool.query(`TRUNCATE TABLE ${USER_DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function countRows(tableName) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Tabla no permitida en countRows: ${tableName}`);
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM ${tableName}`);
  return rows[0].total;
}
