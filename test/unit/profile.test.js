import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/userModel.js', () => ({
  default: {
    createUserProfile: vi.fn(),
  },
}));

import User from '../../models/userModel.js';
import { saveProfile } from '../../controllers/profileController.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Perfil del deportista - unitarias', () => {
  beforeEach(() => vi.clearAllMocks());

  const validProfile = {
    age: 25,
    weight: 70,
    height: 175,
    gender: 'hombre',
    activity_level: 'moderado',
    training_frequency: '3-4',
    primary_goal: 'mejor rendimiento',
    sweat_level: 'medio',
    caffeine_tolerance: 'medio',
    dietary_restrictions: 'no',
  };

  it('creación de perfil válido', async () => {
    User.createUserProfile.mockResolvedValue(undefined);
    const req = { params: { userId: '10' }, body: validProfile };
    const res = mockRes();
    await saveProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(User.createUserProfile).toHaveBeenCalledWith(10, validProfile);
  });

  it('actualización de perfil (upsert)', async () => {
    User.createUserProfile.mockResolvedValue(undefined);
    const updated = { ...validProfile, weight: 72 };
    const req = { params: { userId: '10' }, body: updated };
    const res = mockRes();
    await saveProfile(req, res);
    expect(User.createUserProfile).toHaveBeenCalledWith(10, updated);
  });

  it('validación de edad fuera de rango', async () => {
    const req = { params: { userId: '10' }, body: { ...validProfile, age: 8 } };
    const res = mockRes();
    await saveProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('datos incompletos devuelven 400', async () => {
    const req = { params: { userId: '10' }, body: { age: 25 } };
    const res = mockRes();
    await saveProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('restricciones dietéticas se persisten', async () => {
    User.createUserProfile.mockResolvedValue(undefined);
    const req = {
      params: { userId: '10' },
      body: { ...validProfile, dietary_restrictions: 'vegano' },
    };
    const res = mockRes();
    await saveProfile(req, res);
    expect(User.createUserProfile.mock.calls[0][1].dietary_restrictions).toBe('vegano');
  });
});
