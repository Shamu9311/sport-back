import express from 'express';
import NotificationController from '../controllers/notificationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireMatchingUserId } from '../middleware/ownershipMiddleware.js';

const router = express.Router();

router.get(
  '/preferences/:userId',
  authMiddleware,
  requireMatchingUserId('userId'),
  NotificationController.getPreferences
);
router.put(
  '/preferences/:userId',
  authMiddleware,
  requireMatchingUserId('userId'),
  NotificationController.updatePreferences
);

export default router;

