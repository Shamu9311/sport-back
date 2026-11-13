import { describe, it, expect } from 'vitest';
import { parseDatabaseUrl, resolveDatabaseUrl } from '../../config/dbConfig.js';
import { parseValuesBlock } from '../../scripts/lib/mariadbDump.js';
import { validateEmbedding } from '../../scripts/lib/embeddingImport.js';

describe('Configuración PostgreSQL', () => {
  it('parsea una URL del Session pooler de Supabase', () => {
    const cfg = parseDatabaseUrl(
      'postgresql://postgres.abcdef:secreto@aws-0-us-west-2.pooler.supabase.com:5432/postgres'
    );
    expect(cfg).toMatchObject({
      user: 'postgres.abcdef',
      password: 'secreto',
      host: 'aws-0-us-west-2.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
    });
  });

  it('tolera contraseñas sin codificar con caracteres reservados', () => {
    const cfg = parseDatabaseUrl('postgresql://postgres.x:p?a/s&s@w0rd@db.example.com:6543/postgres');
    expect(cfg.password).toBe('p?a/s&s@w0rd');
    expect(cfg.host).toBe('db.example.com');
    expect(cfg.port).toBe(6543);
  });

  it('decodifica contraseñas codificadas en la URL', () => {
    const cfg = parseDatabaseUrl('postgres://u:p%40ss%3F@h:5432/db');
    expect(cfg.password).toBe('p@ss?');
  });

  it('en NODE_ENV=test usa TEST_DATABASE_URL y nunca la principal', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(resolveDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });
});

describe('Lector del dump MariaDB', () => {
  it('interpreta cadenas, escapes, NULL y números', () => {
    const block = "(1, 'O\\'Neil', NULL, 2.50, 'línea\\nnueva', 'it''s'),\n(2, 'b', 0, -3, '', 'x');";
    const { rows } = parseValuesBlock(block);
    expect(rows).toEqual([
      [1, "O'Neil", null, 2.5, 'línea\nnueva', "it's"],
      [2, 'b', 0, -3, '', 'x'],
    ]);
  });

  it('valida embeddings del dump', () => {
    expect(validateEmbedding(JSON.stringify(new Array(768).fill(0.1))).ok).toBe(true);
    expect(validateEmbedding('[1,2,3]')).toMatchObject({ ok: false });
    expect(validateEmbedding(JSON.stringify(new Array(768).fill(0)))).toMatchObject({ ok: false });
    expect(validateEmbedding('no-json')).toMatchObject({ ok: false, reason: 'JSON inválido' });
  });
});
