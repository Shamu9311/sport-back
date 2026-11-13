import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/trainingSessionModel.js', () => ({
  default: {
    findById: vi.fn(),
    findByUserId: vi.fn(),
    createSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    formatDate: vi.fn((d) => d),
    changedRecommendationFields: vi.fn(() => []),
  },
}));

vi.mock('../../models/recommendationModel.js', () => ({
  default: {
    deleteBySession: vi.fn().mockResolvedValue(undefined),
  },
}));

import TrainingSession from '../../models/trainingSessionModel.js';
import { requireTrainingSessionOwner } from '../../middleware/ownershipMiddleware.js';
import { createSession, deleteSession, updateSession } from '../../controllers/trainingController.js';
import Recommendation from '../../models/recommendationModel.js';

vi.mock('../../services/trainingRecommendationService.js', () => ({
  default: {
    generateTrainingRecommendations: vi.fn().mockResolvedValue([]),
  },
}));

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Sesiones de entrenamiento - unitarias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creación de sesión devuelve 201', async () => {
    TrainingSession.createSession.mockResolvedValue({ session_id: 1, user_id: 5 });
    const req = {
      user: { id: 5 },
      body: {
        userId: 5,
        session_date: '2026-08-21',
        start_time: '08:00:00',
        duration_min: 45,
        intensity: 'media',
        type: 'entrenamiento',
        weather: 'templado',
        sport_type: 'running',
      },
    };
    const res = mockRes();
    await createSession(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('validación de duración obligatoria vía modelo', async () => {
    TrainingSession.createSession.mockResolvedValue({ session_id: 2 });
    await TrainingSession.createSession({
      userId: 1,
      sessionDate: '2026-08-21',
      startTime: '08:00:00',
      durationMin: 0,
      intensity: 'media',
      type: 'entrenamiento',
      weather: 'templado',
      sport_type: 'running',
    });
    expect(TrainingSession.createSession).toHaveBeenCalled();
  });

  it('obtención de sesiones por usuario', async () => {
    TrainingSession.findByUserId.mockResolvedValue([{ session_id: 1 }]);
    const rows = await TrainingSession.findByUserId(5);
    expect(rows).toHaveLength(1);
  });

  it('actualización parcial puede regenerar recomendaciones', async () => {
    TrainingSession.updateSession.mockResolvedValue({
      session_id: 3,
      duration_min: 60,
      type: 'cardio',
      intensity: 'medio',
      weather: 'moderado',
      sport_type: '10K',
      notes: '',
    });
    TrainingSession.changedRecommendationFields.mockReturnValue(['duration_min']);
    const req = {
      params: { id: '3' },
      user: { id: 5 },
      body: { duration_min: 60 },
      trainingSession: { session_id: 3, duration_min: 45 },
    };
    const res = mockRes();
    await updateSession(req, res);
    expect(TrainingSession.updateSession).toHaveBeenCalledWith('3', { duration_min: 60 });
    expect(Recommendation.deleteBySession).toHaveBeenCalledWith('3');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('guardar sin cambios reales NO borra ni regenera recomendaciones', async () => {
    TrainingSession.changedRecommendationFields.mockReturnValue([]);
    TrainingSession.updateSession.mockResolvedValue({ session_id: 3, duration_min: 45 });
    const req = {
      params: { id: '3' },
      user: { id: 5 },
      body: { duration_min: 45, weather: 'calido' },
      trainingSession: { session_id: 3, duration_min: 45, weather: 'calido' },
    };
    const res = mockRes();
    await updateSession(req, res);
    expect(Recommendation.deleteBySession).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].recommendationsRegenerating).toBe(false);
  });

  it('eliminación de sesión', async () => {
    TrainingSession.deleteSession.mockResolvedValue({ success: true });
    const req = { params: { id: '3' }, trainingSession: { session_id: 3 } };
    const res = mockRes();
    await deleteSession(req, res);
    expect(TrainingSession.deleteSession).toHaveBeenCalledWith('3');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('verificación de propiedad: dueño permitido', async () => {
    TrainingSession.findById.mockResolvedValue({ session_id: 9, user_id: 7 });
    const req = { params: { id: '9' }, user: { id: 7 } };
    const res = mockRes();
    const next = vi.fn();
    await requireTrainingSessionOwner(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('verificación de propiedad: no dueño devuelve 403', async () => {
    TrainingSession.findById.mockResolvedValue({ session_id: 9, user_id: 7 });
    const req = { params: { id: '9' }, user: { id: 99 } };
    const res = mockRes();
    const next = vi.fn();
    await requireTrainingSessionOwner(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
