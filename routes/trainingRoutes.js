import express from 'express';
import TrainingSession from '../models/trainingSessionModel.js';
import TrainingRecommendationService from '../services/trainingRecommendationService.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';
import {
  requireMatchingUserId,
  requireTrainingSessionOwner,
} from '../middleware/ownershipMiddleware.js';

const router = express.Router();

// Get all training sessions for a user
router.get('/user/:userId', authMiddleware, requireMatchingUserId('userId'), async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await TrainingSession.findByUserId(userId);
    return sendSuccess(res, 200, { data: sessions });
  } catch (error) {
    console.error('Error fetching training sessions:', error);
    return sendError(res, 500, 'Error al obtener sesiones de entrenamiento', error);
  }
});

// Create a new training session (antes de rutas /:id)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { userId, session_date, start_time, duration_min, intensity, type, weather, sport_type, notes } = req.body;
    
    if (!userId) {
      return sendError(res, 400, 'El ID de usuario es obligatorio');
    }
    if (parseInt(userId, 10) !== req.user.id) {
      return sendError(res, 403, 'Acceso denegado');
    }
    
    // Crear la sesión de entrenamiento
    const session = await TrainingSession.createSession({
      userId,
      sessionDate: session_date,
      startTime: start_time,
      durationMin: duration_min,
      intensity,
      type,
      weather,
      sport_type,
      notes
    });

    // Generar recomendaciones en segundo plano (no esperar a que terminen)
    try {
      const trainingData = {
        type,
        intensity,
        durationMin: duration_min,
        weather,
        sport_type,
        notes
      };
      
      TrainingRecommendationService.generateTrainingRecommendations(
        userId, 
        session.session_id, 
        trainingData
      )
      .catch(err => console.error('Error generando recomendaciones:', err));
      
    } catch (recError) {
      console.error('Error en generación de recomendaciones:', recError);
      // No fallar la petición si hay error en recomendaciones
    }
    
    return sendSuccess(res, 201, { data: session, message: 'Sesión de entrenamiento creada correctamente.' });
  } catch (error) {
    console.error('Error creating training session:', error);
    return sendError(res, 500, 'Error al crear la sesión de entrenamiento', error);
  }
});

// Get recommendations for a training session (antes de GET /:id)
router.get('/:id/recommendations', authMiddleware, requireTrainingSessionOwner, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    
    const recommendations = await TrainingRecommendationService.getTrainingSessionRecommendations(
      userId,
      sessionId
    );
    
    return sendSuccess(res, 200, { data: recommendations });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return sendError(res, 500, 'Error al obtener recomendaciones de la sesión', error);
  }
});

// Get a specific training session
router.get('/:id', authMiddleware, requireTrainingSessionOwner, async (req, res) => {
  try {
    return sendSuccess(res, 200, { data: req.trainingSession });
  } catch (error) {
    console.error('Error fetching training session:', error);
    return sendError(res, 500, 'Error al obtener la sesión de entrenamiento', error);
  }
});

// Update a training session
router.put('/:id', authMiddleware, requireTrainingSessionOwner, async (req, res) => {
  try {
    const sessionId = req.params.id;

    const { session_date, start_time, duration_min, intensity, type, weather, sport_type, notes } = req.body;
    
    const updatedSession = await TrainingSession.updateSession(sessionId, {
      sessionDate: session_date,
      startTime: start_time,
      durationMin: duration_min,
      intensity,
      type,
      weather,
      sport_type,
      notes
    });
    
    return sendSuccess(res, 200, { data: updatedSession, message: 'Sesión de entrenamiento actualizada correctamente.' });
  } catch (error) {
    console.error('Error updating training session:', error);
    return sendError(res, 500, 'Error al actualizar la sesión de entrenamiento', error);
  }
});

// Delete a training session
router.delete('/:id', authMiddleware, requireTrainingSessionOwner, async (req, res) => {
  try {
    const sessionId = req.params.id;
    
    await TrainingSession.deleteSession(sessionId);
    
    return sendSuccess(res, 200, { message: 'Sesión de entrenamiento eliminada correctamente.' });
  } catch (error) {
    console.error('Error deleting training session:', error);
    return sendError(res, 500, 'Error al eliminar la sesión de entrenamiento', error);
  }
});

export default router;
