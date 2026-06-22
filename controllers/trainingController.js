import TrainingSession from '../models/trainingSessionModel.js';
import TrainingRecommendationService from '../services/trainingRecommendationService.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

export const getUserSessions = async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await TrainingSession.findByUserId(userId);
    return sendSuccess(res, 200, { data: sessions });
  } catch (error) {
    console.error('Error fetching training sessions:', error);
    return sendError(res, 500, 'Error al obtener sesiones de entrenamiento', error);
  }
};

export const createSession = async (req, res) => {
  try {
    const { userId, session_date, start_time, duration_min, intensity, type, weather, sport_type, notes } = req.body;

    if (!userId) {
      return sendError(res, 400, 'El ID de usuario es obligatorio');
    }
    if (parseInt(userId, 10) !== req.user.id) {
      return sendError(res, 403, 'Acceso denegado');
    }

    const session = await TrainingSession.createSession({
      userId,
      sessionDate: session_date,
      startTime: start_time,
      durationMin: duration_min,
      intensity,
      type,
      weather,
      sport_type,
      notes,
    });

    try {
      const trainingData = {
        type,
        intensity,
        durationMin: duration_min,
        weather,
        sport_type,
        notes,
      };

      TrainingRecommendationService.generateTrainingRecommendations(
        userId,
        session.session_id,
        trainingData
      ).catch((err) => console.error('Error generando recomendaciones:', err));
    } catch (recError) {
      console.error('Error en generación de recomendaciones:', recError);
    }

    return sendSuccess(res, 201, {
      data: session,
      message: 'Sesión de entrenamiento creada correctamente.',
    });
  } catch (error) {
    console.error('Error creating training session:', error);
    return sendError(res, 500, 'Error al crear la sesión de entrenamiento', error);
  }
};

export const getSessionRecommendations = async (req, res) => {
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
};

export const getSession = async (req, res) => {
  try {
    return sendSuccess(res, 200, { data: req.trainingSession });
  } catch (error) {
    console.error('Error fetching training session:', error);
    return sendError(res, 500, 'Error al obtener la sesión de entrenamiento', error);
  }
};

export const updateSession = async (req, res) => {
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
      notes,
    });

    return sendSuccess(res, 200, {
      data: updatedSession,
      message: 'Sesión de entrenamiento actualizada correctamente.',
    });
  } catch (error) {
    console.error('Error updating training session:', error);
    return sendError(res, 500, 'Error al actualizar la sesión de entrenamiento', error);
  }
};

export const deleteSession = async (req, res) => {
  try {
    const sessionId = req.params.id;
    await TrainingSession.deleteSession(sessionId);
    return sendSuccess(res, 200, { message: 'Sesión de entrenamiento eliminada correctamente.' });
  } catch (error) {
    console.error('Error deleting training session:', error);
    return sendError(res, 500, 'Error al eliminar la sesión de entrenamiento', error);
  }
};
