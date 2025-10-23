import { createPool } from 'mysql2/promise'; // Usar la versión promise
import 'dotenv/config';

export const createConnection = () => {
  return createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
};

// Crear y exportar el pool
const pool = createConnection();
export { pool };
export default pool;

// Test de conexión automático
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Conexión a MySQL exitosa');
    conn.release();
  } catch (err) {
    console.error('❌ Error de conexión a MySQL:', err);
  }
})();