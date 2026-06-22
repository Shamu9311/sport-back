import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  requireMatchingUserId,
  requireTrainingSessionOwner,
} from '../middleware/ownershipMiddleware.js';
import {
  getUserSessions,
  createSession,
  getSessionRecommendations,
  getSession,
  updateSession,
  deleteSession,
} from '../controllers/trainingController.js';

const router = express.Router();

router.get('/user/:userId', authMiddleware, requireMatchingUserId('userId'), getUserSessions);
router.post('/', authMiddleware, createSession);
router.get('/:id/recommendations', authMiddleware, requireTrainingSessionOwner, getSessionRecommendations);
router.get('/:id', authMiddleware, requireTrainingSessionOwner, getSession);
router.put('/:id', authMiddleware, requireTrainingSessionOwner, updateSession);
router.delete('/:id', authMiddleware, requireTrainingSessionOwner, deleteSession);

export default router;
