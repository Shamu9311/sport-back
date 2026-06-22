import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getRecommendations,
  postRecommendationFeedback,
  getSavedRecommendations,
  postProductFeedback,
  getUserFeedback,
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

const recommendationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Demasiadas solicitudes de recomendaciones. Intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authMiddleware);
router.use(recommendationsLimiter);

// Generar recomendaciones (POST: cuerpo JSON con trainingData opcional; GET con body no es fiable)
router.post('/', getRecommendations);

// Recomendaciones guardadas (solo el usuario autenticado)
router.get('/saved', getSavedRecommendations);

// Ruta para feedback (antigua - puede usar el controller)
router.post('/feedback', postRecommendationFeedback);

// Feedback de productos
router.post('/product-feedback', postProductFeedback);

// Historial de feedback del usuario
router.get('/user-feedback', getUserFeedback);

export default router;
