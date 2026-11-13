import { describe, it, expect } from 'vitest';
import pool from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { runIntegrityChecks } from '../../scripts/verifyIntegrity.js';
import { readDump } from '../../scripts/lib/mariadbDump.js';

describe('Esquema PostgreSQL migrado', () => {
  it('las migraciones son idempotentes (no hay pendientes)', async () => {
    const client = await pool.connect();
    try {
      const applied = await runMigrations(client, { log: () => {} });
      expect(applied).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('product_embeddings.embedding es vector(768)', async () => {
    const { rows } = await pool.query(`
      SELECT format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
      WHERE a.attrelid = 'public.product_embeddings'::regclass AND a.attname = 'embedding'`);
    expect(rows[0].type).toMatch(/vector\(768\)/);
  });

  it('existen las tablas de la capa de evidencia con vector(768) en evidence_chunks', async () => {
    const { rows } = await pool.query(`
      SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname IN ('evidence_sources','evidence_chunks','evidence_claims','product_evidence')`);
    expect(rows.map((r) => r.relname).sort()).toEqual(
      ['evidence_chunks', 'evidence_claims', 'evidence_sources', 'product_evidence']
    );
    const { rows: col } = await pool.query(`
      SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid = 'public.evidence_chunks'::regclass AND a.attname = 'embedding'`);
    expect(col[0].type).toMatch(/vector\(768\)/);
  });

  it('los CHECK reemplazan a los ENUM de MariaDB', async () => {
    await expect(
      pool.query("INSERT INTO product_categories (name) VALUES ('no-existe')")
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('email único sin distinguir mayúsculas (como utf8mb4_general_ci)', async () => {
    const email = `Case_${Date.now()}@Test.local`;
    await pool.query("INSERT INTO users (username, email, password) VALUES ('a', $1, 'x')", [email]);
    await expect(
      pool.query("INSERT INTO users (username, email, password) VALUES ('b', $1, 'x')", [email.toLowerCase()])
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query('DELETE FROM users WHERE lower(email) = lower($1)', [email]);
  });

  it('updated_at se actualiza por trigger (ON UPDATE CURRENT_TIMESTAMP)', async () => {
    const { rows: u } = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ('t', $1, 'x') RETURNING user_id",
      [`trg_${Date.now()}@test.local`]
    );
    const userId = u[0].user_id;
    await pool.query("INSERT INTO user_product_feedback (user_id, product_id, feedback) VALUES ($1, 1, 'positivo')", [userId]);
    await pool.query("UPDATE user_product_feedback SET feedback = 'negativo' WHERE user_id = $1", [userId]);
    const { rows } = await pool.query('SELECT updated_at FROM user_product_feedback WHERE user_id = $1', [userId]);
    expect(rows[0].updated_at).toBeInstanceOf(Date);
    await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
  });

  it('verificación de integridad completa sin fallos', async () => {
    const client = await pool.connect();
    try {
      const original = console.log;
      console.log = () => {};
      let results;
      try {
        results = await runIntegrityChecks(client, { dump: readDump() });
      } finally {
        console.log = original;
      }
      const failed = results.filter((r) => !r.ok);
      expect(failed).toEqual([]);
    } finally {
      client.release();
    }
  });
});
