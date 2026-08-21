import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../../app.js';

const TEST_PASSWORD = 'TestPass123!';

export function uniqueEmail(prefix = 'test') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.local`;
}

export function uniqueUsername(prefix = 'user') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function registerUser(overrides = {}) {
  const payload = {
    username: overrides.username || uniqueUsername(),
    email: overrides.email || uniqueEmail(),
    password: overrides.password || TEST_PASSWORD,
  };

  const res = await request(app).post('/api/auth/register').send(payload);
  return { payload, response: res };
}

export async function loginUser(email, password = TEST_PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

export async function createUserAndLogin(overrides = {}) {
  const { payload, response: registerRes } = await registerUser(overrides);
  expect(registerRes.status).toBe(201);

  const loginRes = await loginUser(payload.email, payload.password);
  expect(loginRes.status).toBe(200);

  return {
    user: loginRes.body.user,
    token: loginRes.body.token,
    credentials: payload,
  };
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

export function makeToken(payload = {}, options = {}) {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret-sport-thesis-2026';
  const defaultPayload = { id: 1, email: 'token@test.local' };
  return jwt.sign({ ...defaultPayload, ...payload }, secret, {
    expiresIn: options.expired ? '-1s' : options.expiresIn || '1h',
  });
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export { TEST_PASSWORD };
