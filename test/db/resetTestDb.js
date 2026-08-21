import pool from '../../config/db.js';

const USER_DATA_TABLES = [
  'user_product_feedback',
  'recommendations',
  'training_sessions',
  'user_profiles',
  'notification_preferences',
  'users',
];

export async function resetUserData() {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of USER_DATA_TABLES) {
    await pool.query(`TRUNCATE TABLE \`${table}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

export async function countRows(tableName) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${tableName}\``);
  return rows[0].total;
}
