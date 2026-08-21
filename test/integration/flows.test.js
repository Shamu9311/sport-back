import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app.js';
import { resetUserData } from '../db/resetTestDb.js';
import {
  authHeader,
  createUserAndLogin,
  registerUser,
  loginUser,
  uniqueEmail,
} from '../helpers/authHelpers.js';
import {
  validProfilePayload,
  validTrainingPayload,
  waitForRecommendations,
} from '../helpers/requestHelpers.js';

describe('Integración backend - flujos completos', () => {
  beforeAll(async () => {
    process.env.MOCK_LLM = 'true';
    process.env.MOCK_LLM_DELAY_MS = '50';
    process.env.MOCK_EMBEDDINGS = 'true';
  });

  beforeEach(async () => {
    await resetUserData();
  });

  afterAll(async () => {
    await resetUserData();
  });

  it('FLUJO 1: register → login → verificar JWT', async () => {
    const email = uniqueEmail('flow1');
    const registerRes = await registerUser({ email });
    expect(registerRes.response.status).toBe(201);

    const loginRes = await loginUser(email);
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();

    const decoded = jwt.verify(loginRes.body.token, process.env.JWT_SECRET);
    expect(decoded.email).toBe(email);

    const protectedRes = await request(app)
      .get(`/api/profile/${decoded.id}/profile`)
      .set(authHeader(loginRes.body.token));
    expect(protectedRes.status).toBe(200);
  });

  it('FLUJO 2: login → crear perfil → consultar → actualizar', async () => {
    const { user, token } = await createUserAndLogin();
    const profile = validProfilePayload();

    const createRes = await request(app)
      .post(`/api/profile/${user.id}/profile`)
      .set(authHeader(token))
      .send(profile);
    expect(createRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/profile/${user.id}/profile`)
      .set(authHeader(token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.profile.age).toBe(profile.age);

    const updateRes = await request(app)
      .post(`/api/profile/${user.id}/profile`)
      .set(authHeader(token))
      .send({ ...profile, weight: 68 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.weight).toBe(68);
  });

  it('FLUJO 3: training → recomendaciones mock → exactamente 4', async () => {
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
    const { recommendations } = await waitForRecommendations(token, sessionId);
    expect(recommendations).toHaveLength(4);
  });

  it('FLUJO 4: feedback negativo excluye producto en nueva sesión', async () => {
    const { user, token } = await createUserAndLogin();
    await request(app)
      .post(`/api/profile/${user.id}/profile`)
      .set(authHeader(token))
      .send(validProfilePayload());

    const firstSession = await request(app)
      .post('/api/training')
      .set(authHeader(token))
      .send(validTrainingPayload(user.id));
    const sessionId = firstSession.body.data.session_id;
    const { recommendations } = await waitForRecommendations(token, sessionId);
    const rejectedProductId = recommendations[0].product_id;

    await request(app)
      .post('/api/recommendations/product-feedback')
      .set(authHeader(token))
      .send({
        userId: user.id,
        productId: rejectedProductId,
        feedback: 'negativo',
      });

    const secondSession = await request(app)
      .post('/api/training')
      .set(authHeader(token))
      .send(validTrainingPayload(user.id, { notes: 'Segunda sesión' }));
    const secondId = secondSession.body.data.session_id;
    const { recommendations: secondRecs } = await waitForRecommendations(token, secondId);
    const secondIds = secondRecs.map((r) => r.product_id);
    expect(secondIds).not.toContain(rejectedProductId);
  });

  it('FLUJO 5: catálogo → filtros → detalle completo', async () => {
    const searchRes = await request(app).get('/api/products/search').query({ q: 'gel' });
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.body.data?.products)).toBe(true);

    const categoriesRes = await request(app).get('/api/products/categories');
    expect(categoriesRes.status).toBe(200);

    const productId = searchRes.body.data.products[0]?.product_id;
    expect(productId).toBeTruthy();

    const fullRes = await request(app).get(`/api/products/${productId}/full`);
    expect(fullRes.status).toBe(200);
    expect(fullRes.body.data).toHaveProperty('nutrition');
  });

  it('devuelve 400, 401, 403, 404 y 409 cuando corresponde', async () => {
    await request(app).post('/api/auth/login').send({ email: '', password: '' }).expect(400);
    await request(app).get('/api/profile/1/profile').expect(401);

    const { user, token } = await createUserAndLogin();
    await request(app)
      .get(`/api/profile/${user.id + 1000}/profile`)
      .set(authHeader(token))
      .expect(403);

    await request(app)
      .get(`/api/training/999999/recommendations`)
      .set(authHeader(token))
      .expect(404);

    const email = uniqueEmail('dup409');
    await registerUser({ email });
    const dup = await registerUser({ email });
    expect(dup.response.status).toBe(409);
  });
});
