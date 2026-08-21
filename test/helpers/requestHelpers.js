import request from 'supertest';
import app from '../../app.js';
import { authHeader } from './authHelpers.js';

export async function waitForRecommendations(token, sessionId, options = {}) {
  const testApp = options.app || app;
  const maxAttempts = options.maxAttempts || 30;
  const intervalMs = options.intervalMs || 200;
  let lastBody = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await request(testApp)
      .get(`/api/training/${sessionId}/recommendations`)
      .set(authHeader(token));

    lastBody = res.body;

    if (res.status === 200 && Array.isArray(res.body?.data) && res.body.data.length > 0) {
      return { response: res, recommendations: res.body.data };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timeout esperando recomendaciones para sesión ${sessionId}. Última respuesta: ${JSON.stringify(lastBody)}`
  );
}

export function validTrainingPayload(userId, overrides = {}) {
  return {
    userId,
    session_date: '2026-08-21',
    start_time: '08:00:00',
    duration_min: 60,
    intensity: 'media',
    type: 'entrenamiento',
    sport_type: 'running',
    weather: 'templado',
    notes: 'Sesión de prueba automatizada',
    ...overrides,
  };
}

export function validProfilePayload(overrides = {}) {
  return {
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
    ...overrides,
  };
}
