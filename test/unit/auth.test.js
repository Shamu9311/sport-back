import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';

vi.mock('../../models/userModel.js', () => ({
  default: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
  },
}));

import User from '../../models/userModel.js';
import { register, login } from '../../controllers/authController.js';
import authMiddleware from '../../middleware/authMiddleware.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Autenticación - unitarias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registro válido devuelve 201', async () => {
    User.findByEmail.mockResolvedValue(null);
    User.findByUsername.mockResolvedValue(null);
    User.create.mockResolvedValue({
      user_id: 1,
      username: 'testuser',
      email: 'valid@test.local',
      created_at: new Date().toISOString(),
    });

    const req = {
      body: { username: 'testuser', email: 'valid@test.local', password: 'Secret123!' },
    };
    const res = mockRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(User.create).toHaveBeenCalled();
    const hashed = User.create.mock.calls[0][0].password;
    expect(hashed).toMatch(/^\$2b\$/);
  });

  it('email inválido devuelve 400', async () => {
    const req = { body: { username: 'u', email: 'bad-email', password: 'x' } };
    const res = mockRes();
    await register(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('email duplicado devuelve 409', async () => {
    User.findByEmail.mockResolvedValue({ user_id: 99 });
    const req = { body: { username: 'u', email: 'dup@test.local', password: 'x' } };
    const res = mockRes();
    await register(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('usuario duplicado devuelve 409', async () => {
    User.findByEmail.mockResolvedValue(null);
    User.findByUsername.mockResolvedValue({ user_id: 99 });
    const req = { body: { username: 'dup', email: 'ok@test.local', password: 'x' } };
    const res = mockRes();
    await register(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('hash de contraseña usa bcrypt costo 10', async () => {
    const hash = await bcrypt.hash('Secret123!', 10);
    expect(hash.startsWith('$2b$')).toBe(true);
    expect(await bcrypt.compare('Secret123!', hash)).toBe(true);
  });

  it('login correcto devuelve token JWT', async () => {
    const hash = await bcrypt.hash('Secret123!', 10);
    User.findByEmail.mockResolvedValue({
      user_id: 5,
      username: 'loginuser',
      email: 'login@test.local',
      password: hash,
      created_at: new Date().toISOString(),
    });

    const req = { body: { email: 'login@test.local', password: 'Secret123!' } };
    const res = mockRes();
    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.token).toBeTruthy();
    const decoded = jwt.verify(body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(5);
    expect(decoded.email).toBe('login@test.local');
  });

  it('contraseña incorrecta devuelve 401', async () => {
    const hash = await bcrypt.hash('Secret123!', 10);
    User.findByEmail.mockResolvedValue({ user_id: 1, password: hash });
    const req = { body: { email: 'login@test.local', password: 'wrong' } };
    const res = mockRes();
    await login(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('token inválido es rechazado por middleware', () => {
    const req = { header: () => 'Bearer invalid.token.here' };
    const res = mockRes();
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('token expirado es rechazado por middleware', () => {
    const expired = jwt.sign({ id: 1, email: 'x@test.local' }, process.env.JWT_SECRET, {
      expiresIn: '-1s',
    });
    const req = { header: () => `Bearer ${expired}` };
    const res = mockRes();
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].message).toMatch(/expirado/i);
  });
});
