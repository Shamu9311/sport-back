import express from 'express';
import NotificationController from '../controllers/notificationController.js';

const router = express.Router();

router.get('/preferences/:userId', NotificationController.getPreferences);
router.put('/preferences/:userId', NotificationController.updatePreferences);

export default router;

