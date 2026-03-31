import express from 'express';
import { saveProfile, getProfile } from '../controllers/profileController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireMatchingUserId } from '../middleware/ownershipMiddleware.js';

const router = express.Router();

router.post('/:userId/profile', authMiddleware, requireMatchingUserId('userId'), saveProfile);
router.get('/:userId/profile', authMiddleware, requireMatchingUserId('userId'), getProfile);

export default router;