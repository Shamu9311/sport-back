import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import pool from '../../config/db.js';
import { resetUserData, countRows } from '../db/resetTestDb.js';
import {
  authHeader,
  createUserAndLogin,
  makeToken,
  loginUser,
  uniqueEmail,
  registerUser,
} from '../helpers/authHelpers.js';
import { validProfilePayload, validTrainingPayload } from '../helpers/requestHelpers.js';
import { SQLI_PAYLOADS } from '../helpers/sqliPayloads.js';

describe('Seguridad - controles automatizados', () => {
  beforeEach(async () => {
    process.env.RATE_LIMIT_MAX_AUTH = '10';
    process.env.RATE_LIMIT_MAX_RECS = '30';
    await resetUserData();
  });

  afterAll(async () => {
    await resetUserData();
  });

  it('endpoint protegido sin JWT devuelve 401', async () => {
    const res = await request(app).get('/api/recommendations/saved');
    expect(res.status).toBe(401);
  });

  it('JWT inválido devuelve 401', async () => {
    const res = await request(app)
      .get('/api/recommendations/saved')
      .set(authHeader('token.invalido'));
    expect(res.status).toBe(401);
  });

  it('acceso a perfil de otro usuario devuelve 403', async () => {
    const userA = await createUserAndLogin();
    const userB = await createUserAndLogin();
    const res = await request(app)
      .get(`/api/profile/${userB.user.id}/profile`)
      .set(authHeader(userA.token));
    expect(res.status).toBe(403);
  });

  it('acceso a sesión de otro usuario devuelve 403', async () => {
    const userA = await createUserAndLogin();
    const userB = await createUserAndLogin();

    await request(app)
      .post(`/api/profile/${userB.user.id}/profile`)
      .set(authHeader(userB.token))
      .send(validProfilePayload());

    const sessionRes = await request(app)
      .post('/api/training')
      .set(authHeader(userB.token))
      .send(validTrainingPayload(userB.user.id));

    const res = await request(app)
      .get(`/api/training/${sessionRes.body.data.session_id}/recommendations`)
      .set(authHeader(userA.token));
    expect(res.status).toBe(403);
  });

  it('rate limiting en login tras múltiples intentos', async () => {
    vi.resetModules();
    process.env.RATE_LIMIT_MAX_AUTH = '3';
    const { default: limitedApp } = await import('../../app.js');
    const email = uniqueEmail('ratelimit');

    for (let i = 0; i < 3; i += 1) {
      await request(limitedApp).post('/api/auth/login').send({ email, password: 'wrong-password' });
    }

    const blocked = await request(limitedApp)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(blocked.status).toBe(429);

    vi.resetModules();
    process.env.RATE_LIMIT_MAX_AUTH = '10';
  });

  it('payloads SQLi no destruyen tablas', async () => {
    const usersBefore = await countRows('users');

    for (const payload of SQLI_PAYLOADS) {
      await request(app).post('/api/auth/login').send({ email: payload, password: payload });
      await request(app).get('/api/products/search').query({ q: payload });
    }

    const usersAfter = await countRows('users');
    expect(usersAfter).toBeGreaterThanOrEqual(usersBefore);

    const [tables] = await pool.query("SHOW TABLES LIKE 'users'");
    expect(tables.length).toBe(1);
  });

  it('cabeceras Helmet presentes', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('body JSON mayor a 100kb devuelve 413', async () => {
    const bigPayload = { data: 'x'.repeat(110 * 1024) };
    const res = await request(app).post('/api/auth/login').send(bigPayload);
    expect(res.status).toBe(413);
  });

  it('token expirado devuelve 401', async () => {
    const expired = makeToken({ id: 1, email: 'exp@test.local' }, { expired: true });
    const res = await request(app)
      .get('/api/recommendations/saved')
      .set(authHeader(expired));
    expect(res.status).toBe(401);
  });
});
