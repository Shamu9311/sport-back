import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { resetUserData } from '../db/resetTestDb.js';
import { createUserAndLogin, authHeader } from '../helpers/authHelpers.js';
import {
  validProfilePayload,
  validTrainingPayload,
  waitForRecommendations,
} from '../helpers/requestHelpers.js';
import { generateUserProfileEmbedding } from '../../services/embeddingServices.js';
import { cosineSimilarity } from '../../services/vectorSearchService.js';
import pool from '../../config/db.js';

async function loadAppWithVectorSearch(enabled) {
  vi.resetModules();
  process.env.USE_VECTOR_SEARCH = enabled ? 'true' : 'false';
  process.env.MOCK_LLM = 'true';
  process.env.MOCK_LLM_DELAY_MS = '20';
  process.env.MOCK_EMBEDDINGS = 'true';

  const { default: app } = await import('../../app.js');
  return app;
}

describe('Flujo vectorial RAG', () => {
  let app;

  beforeAll(async () => {
    app = await loadAppWithVectorSearch(true);
  });

  beforeEach(async () => {
    await resetUserData();
  });

  afterAll(async () => {
    vi.resetModules();
    process.env.USE_VECTOR_SEARCH = 'false';
    await resetUserData();
  });

  it('construye embedding de perfil de 768 dimensiones', async () => {
    const embedding = await generateUserProfileEmbedding({
      primary_goal: 'mejor rendimiento',
      dietary_restrictions: 'no',
      caffeine_tolerance: 'medio',
      activity_level: 'moderado',
      training_frequency: '3-4',
      intensity: 'media',
      duration: 60,
      training_type: 'entrenamiento',
    });
    expect(embedding).toHaveLength(768);
  });

  it('recupera embeddings de productos y calcula similitud coseno', async () => {
    const [rows] = await pool.query(
      'SELECT embedding FROM product_embeddings WHERE product_id = 1 LIMIT 1'
    );
    expect(rows.length).toBe(1);
    const productEmbedding = JSON.parse(rows[0].embedding);
    const profileEmbedding = await generateUserProfileEmbedding({
      primary_goal: 'mejor rendimiento',
      dietary_restrictions: 'no',
    });
    const similarity = cosineSimilarity(profileEmbedding, productEmbedding);
    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it('flujo completo vectorial persiste 4 recomendaciones', async () => {
    const { user, token } = await createUserAndLogin();
    await request(app)
      .post(`/api/profile/${user.id}/profile`)
      .set(authHeader(token))
      .send(validProfilePayload());

    const trainingRes = await request(app)
      .post('/api/training')
      .set(authHeader(token))
      .send(validTrainingPayload(user.id));
    expect(trainingRes.status).toBe(201);

    const sessionId = trainingRes.body.data.session_id;
    const { recommendations } = await waitForRecommendations(token, sessionId, { app });
    expect(recommendations).toHaveLength(4);
  });
});

describe('Flujo SQL alternativo (USE_VECTOR_SEARCH=false)', () => {
  let app;

  beforeAll(async () => {
    app = await loadAppWithVectorSearch(false);
  });

  beforeEach(async () => {
    await resetUserData();
  });

  afterAll(async () => {
    vi.resetModules();
    await resetUserData();
  });

  it('genera recomendaciones usando recuperación SQL', async () => {
    const { user, token } = await createUserAndLogin();
    await request(app)
      .post(`/api/profile/${user.id}/profile`)
      .set(authHeader(token))
      .send(validProfilePayload());

    const trainingRes = await request(app)
      .post('/api/training')
      .set(authHeader(token))
      .send(validTrainingPayload(user.id));
    expect(trainingRes.status).toBe(201);

    const sessionId = trainingRes.body.data.session_id;
    const { recommendations } = await waitForRecommendations(token, sessionId, { app });
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.length).toBeLessThanOrEqual(4);
  });
});
