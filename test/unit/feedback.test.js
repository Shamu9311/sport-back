import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Feedback from '../../models/feedbackModel.js';
import { getCandidateProductsWithSQL } from '../../services/retrievalService.js';
import { resetUserData } from '../db/resetTestDb.js';
import { createUserAndLogin } from '../helpers/authHelpers.js';

describe('Feedback - unitarias con BD de test', () => {
  let userId;

  beforeAll(async () => {
    const session = await createUserAndLogin();
    userId = session.user.id;
  });

  beforeEach(async () => {
    await Feedback.deleteFeedback(userId, 1);
    await Feedback.deleteFeedback(userId, 2);
  });

  afterAll(async () => {
    await resetUserData();
  });

  it('guardar feedback positivo', async () => {
    const result = await Feedback.saveFeedback({
      userId,
      productId: 1,
      feedback: 'positivo',
    });
    expect(result.success).toBe(true);
  });

  it('guardar feedback negativo', async () => {
    await Feedback.saveFeedback({ userId, productId: 2, feedback: 'negativo' });
    const saved = await Feedback.getUserProductFeedback(userId, 2);
    expect(saved.feedback).toBe('negativo');
  });

  it('actualizar feedback existente (upsert)', async () => {
    await Feedback.saveFeedback({ userId, productId: 1, feedback: 'positivo' });
    await Feedback.saveFeedback({ userId, productId: 1, feedback: 'negativo' });
    const saved = await Feedback.getUserProductFeedback(userId, 1);
    expect(saved.feedback).toBe('negativo');
  });

  it('producto con feedback negativo queda excluido en SQL retrieval', async () => {
    await Feedback.saveFeedback({ userId, productId: 1, feedback: 'negativo' });
    const excluded = await Feedback.getNegativeFeedbackProducts(userId);
    expect(excluded).toContain(1);

    const candidates = await getCandidateProductsWithSQL(
      { user_id: userId, primary_goal: 'mejor rendimiento', caffeine_tolerance: 'medio', dietary_restrictions: 'no' },
      excluded
    );
    const ids = candidates.map((p) => p.product_id);
    expect(ids).not.toContain(1);
  });
});
