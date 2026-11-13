// scripts/lib/mariadbDump.js — Lector de los INSERT de un dump phpMyAdmin/MariaDB.
// No ejecuta SQL de MariaDB: solo extrae valores (tablas, columnas y filas) para reinsertarlos en PostgreSQL.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DUMP_PATH = path.resolve(__dirname, '../../db/legacy-mariadb/sport.mariadb.sql');

const ESCAPES = { n: '\n', r: '\r', t: '\t', 0: '\0', b: '\b', Z: '\x1a', '\\': '\\', "'": "'", '"': '"' };

/** Parsea el bloque VALUES (...),(...); devuelve arrays de valores JS (string | number | null). */
export function parseValuesBlock(text, start = 0) {
  const rows = [];
  let i = start;
  const len = text.length;

  const skipWs = () => {
    while (i < len && /\s/.test(text[i])) i += 1;
  };

  while (i < len) {
    skipWs();
    if (text[i] === ';') {
      i += 1;
      break;
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    if (text[i] !== '(') {
      throw new Error(`Formato inesperado en el dump cerca de: ${text.slice(i, i + 40)}`);
    }
    i += 1; // (
    const row = [];
    while (i < len) {
      skipWs();
      const ch = text[i];
      if (ch === "'") {
        i += 1;
        let value = '';
        while (i < len) {
          const c = text[i];
          if (c === '\\') {
            const next = text[i + 1];
            value += ESCAPES[next] ?? next;
            i += 2;
          } else if (c === "'" && text[i + 1] === "'") {
            value += "'";
            i += 2;
          } else if (c === "'") {
            i += 1;
            break;
          } else {
            value += c;
            i += 1;
          }
        }
        row.push(value);
      } else {
        let token = '';
        while (i < len && text[i] !== ',' && text[i] !== ')') {
          token += text[i];
          i += 1;
        }
        token = token.trim();
        if (/^NULL$/i.test(token)) row.push(null);
        else if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(token)) row.push(Number(token));
        else row.push(token);
      }
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ')') {
        i += 1;
        break;
      }
    }
    rows.push(row);
  }
  return { rows, end: i };
}

/**
 * Lee el dump y devuelve { tabla: { columns: string[], rows: object[] } }.
 * Soporta varios INSERT por tabla (phpMyAdmin parte tablas grandes).
 */
export function readDump(dumpPath = DEFAULT_DUMP_PATH) {
  const text = fs.readFileSync(dumpPath, 'utf8');
  const tables = {};
  const insertRe = /INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*/g;
  let match;
  while ((match = insertRe.exec(text)) !== null) {
    const table = match[1];
    const columns = match[2].split(',').map((c) => c.trim().replace(/`/g, ''));
    const { rows, end } = parseValuesBlock(text, insertRe.lastIndex);
    insertRe.lastIndex = end;
    if (!tables[table]) tables[table] = { columns, rows: [] };
    for (const values of rows) {
      if (values.length !== columns.length) {
        throw new Error(`Fila de ${table} con ${values.length} valores para ${columns.length} columnas.`);
      }
      const obj = {};
      columns.forEach((col, idx) => {
        obj[col] = values[idx];
      });
      tables[table].rows.push(obj);
    }
  }
  return tables;
}
