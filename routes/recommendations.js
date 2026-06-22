import express from 'express';
import {
  getRecommendations,
  postRecommendationFeedback,
  getSavedRecommendations,
  postProductFeedback,
  getUserFeedback,
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Generar recomendaciones (POST: cuerpo JSON con trainingData opcional; GET con body no es fiable)
router.post('/', authMiddleware, getRecommendations);

// Recomendaciones guardadas (solo el usuario autenticado)
router.get('/saved', authMiddleware, getSavedRecommendations);

// Ruta para feedback (antigua - puede usar el controller)
router.post('/feedback', authMiddleware, postRecommendationFeedback);

// Feedback de productos
router.post('/product-feedback', authMiddleware, postProductFeedback);

// Historial de feedback del usuario
router.get('/user-feedback', authMiddleware, getUserFeedback);

export default router;
