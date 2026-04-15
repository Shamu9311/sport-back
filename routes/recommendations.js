import express from 'express';
import {
  getRecommendations,
  postRecommendationFeedback,
  getSavedRecommendations,
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import Feedback from '../models/feedbackModel.js';
import { sendError } from '../utils/apiResponse.js';

const router = express.Router();

// Generar recomendaciones (POST: cuerpo JSON con trainingData opcional; GET con body no es fiable)
router.post('/', authMiddleware, getRecommendations);

// Recomendaciones guardadas (solo el usuario autenticado)
router.get('/saved', authMiddleware, getSavedRecommendations);

// Ruta para feedback (antigua - puede usar el controller)
router.post('/feedback', authMiddleware, postRecommendationFeedback);

// Nueva ruta para feedback de productos (más específica)
router.post('/product-feedback', authMiddleware, async (req, res) => {
  try {
    const { userId, productId, feedback, notes } = req.body;
    
    if (!userId || !productId || !feedback) {
      return sendError(res, 400, 'userId, productId y feedback son requeridos');
    }
    if (parseInt(userId, 10) !== req.user.id) {
      return sendError(res, 403, 'Acceso denegado');
    }

    if (!['positivo', 'negativo'].includes(feedback)) {
      return sendError(res, 400, 'Feedback debe ser "positivo" o "negativo"');
    }
    
    const result = await Feedback.saveFeedback({
      userId,
      productId,
      feedback,
      notes
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Error en product-feedback:', error);
    return sendError(res, 500, 'Error al guardar el feedback', error);
  }
});

// Obtener feedback del usuario para mostrar en UI
router.get('/user-feedback', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const history = await Feedback.getUserFeedbackHistory(userId);
    
    res.json({
      success: true,
      feedback: history
    });
    
  } catch (error) {
    console.error('Error getting user feedback:', error);
    return sendError(res, 500, 'Error al obtener feedback', error);
  }
});

export default router;