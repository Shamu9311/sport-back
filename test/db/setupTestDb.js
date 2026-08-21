import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });

const SKIP_INSERT_TABLES = new Set([
  'users',
  'user_profiles',
  'notification_preferences',
  'recommendations',
  'training_sessions',
  'user_product_feedback',
]);

function parseSqlStatements(sqlContent) {
  const lines = sqlContent.split('\n');
  const statements = [];
  let current = '';
  let skipInsert = false;

  for (const line of lines) {
    const insertMatch = line.match(/^INSERT INTO `([^`]+)`/i);
    if (insertMatch) {
      skipInsert = SKIP_INSERT_TABLES.has(insertMatch[1]);
    }

    if (skipInsert) {
      if (line.trim().endsWith(';')) {
        skipInsert = false;
      }
      continue;
    }

    if (line.trim().startsWith('--') || line.trim().length === 0) {
      continue;
    }

    current += `${line}\n`;

    if (line.trim().endsWith(';')) {
      const stmt = current.trim();
      if (
        stmt.startsWith('CREATE TABLE') ||
        stmt.startsWith('ALTER TABLE') ||
        stmt.startsWith('INSERT INTO')
      ) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  return statements;
}

export async function setupTestDatabase() {
  const dbName = process.env.DB_NAME || 'sport_test';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await connection.query(
    `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`
  );
  await connection.query(`USE \`${dbName}\``);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');

  const sportSqlPath = path.resolve(__dirname, '../../sport.sql');
  const sqlContent = fs.readFileSync(sportSqlPath, 'utf8');
  const statements = parseSqlStatements(sqlContent);

  for (const statement of statements) {
    await connection.query(statement);
  }

  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  await connection.end();

  console.log(`✅ Base de datos de test "${dbName}" creada con catálogo`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  setupTestDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error configurando BD de test:', error);
      process.exit(1);
    });
}
