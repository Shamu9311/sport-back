import express from 'express';
import {
  getRecommendations,
  postRecommendationFeedback,
  getSavedRecommendations,
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import Feedback from '../models/feedbackModel.js';

const router = express.Router();

// Rutas protegidas con JWT
router.get('/', authMiddleware, getRecommendations);

// Recomendaciones guardadas (solo el usuario autenticado)
router.get('/saved', authMiddleware, getSavedRecommendations);

// Ruta para feedback (antigua - puede usar el controller)
router.post('/feedback', authMiddleware, postRecommendationFeedback);

// Nueva ruta para feedback de productos (más específica)
router.post('/product-feedback', authMiddleware, async (req, res) => {
  try {
    const { userId, productId, feedback, notes } = req.body;
    
    if (!userId || !productId || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'userId, productId y feedback son requeridos'
      });
    }
    if (parseInt(userId, 10) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    
    if (!['positivo', 'negativo'].includes(feedback)) {
      return res.status(400).json({
        success: false,
        message: 'Feedback debe ser "positivo" o "negativo"'
      });
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
    res.status(500).json({
      success: false,
      message: 'Error al guardar el feedback'
    });
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
    res.status(500).json({
      success: false,
      message: 'Error al obtener feedback'
    });
  }
});

export default router;