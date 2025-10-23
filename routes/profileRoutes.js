import express from 'express';
import { saveProfile, getProfile } from '../controllers/profileController.js';

const router = express.Router();

router.post('/:userId/profile', saveProfile);
router.get('/:userId/profile', getProfile);

export default router;