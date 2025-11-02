import express from 'express';
import { 
  getRecommendations,
  getUserRecommendations, 
  postRecommendationFeedback,
  getSavedRecommendations
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import Feedback from '../models/feedbackModel.js';

const router = express.Router();

// Rutas protegidas con JWT
router.get('/', authMiddleware, getRecommendations);

// Ruta para obtener recomendaciones guardadas de un usuario
router.get('/saved/:userId', getSavedRecommendations);

// Ruta pública específica de usuario - Ahora usando la versión avanzada con IA
// Original: router.get('/:userId', getUserRecommendations);
router.get('/:userId', async (req, res) => {
  try {
    // Añadimos req.user ya que getRecommendations lo espera
    req.user = { id: parseInt(req.params.userId, 10) };
    
    if (isNaN(req.user.id) || req.user.id <= 0) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuario inválido'
      });
    }
    
    // Llamar a la versión con IA
    await getRecommendations(req, res);
  } catch (error) {
    console.error('Error al utilizar la versión de IA para recomendaciones:', error);
    console.log('Utilizando versión de respaldo...');
    // Si falla la versión con IA, usar la versión simple como respaldo
    return getUserRecommendations(req, res);
  }
});

// Ruta para feedback (antigua - puede usar el controller)
router.post('/feedback', authMiddleware, postRecommendationFeedback);

// Nueva ruta para feedback de productos (más específica)
router.post('/product-feedback', async (req, res) => {
  try {
    const { userId, productId, feedback, notes } = req.body;
    
    if (!userId || !productId || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'userId, productId y feedback son requeridos'
      });
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
router.get('/user-feedback/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuario inválido'
      });
    }
    
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