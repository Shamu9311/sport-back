import express from 'express';
import { 
  getRecommendations,
  getUserRecommendations, 
  postRecommendationFeedback,
  getSavedRecommendations
} from '../controllers/recommendationController.js';
import authMiddleware from '../middleware/authMiddleware.js';

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

// Ruta para feedback
router.post('/feedback', authMiddleware, postRecommendationFeedback);

export default router;