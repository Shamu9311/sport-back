import TrainingSession from '../models/trainingSessionModel.js';
import Recommendation from '../models/recommendationModel.js';
import TrainingRecommendationService from '../services/trainingRecommendationService.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

function validateTrainingFields(body, { requireAll = false } = {}) {
  const duration = body.duration_min ?? body.durationMin;
  if (requireAll || duration !== undefined) {
    const d = parseInt(duration, 10);
    if (!Number.isFinite(d) || d < 1 || d > 1440) {
      return 'La duración debe estar entre 1 y 1440 minutos.';
    }
  }
  const start = body.start_time ?? body.startTime;
  if (requireAll || start !== undefined) {
    const timeStr = String(start ?? '').substring(0, 8);
    if (!timeStr || !TIME_RE.test(timeStr)) {
      return 'Hora de inicio inválida. Usa formato HH:MM.';
    }
  }
  const date = body.session_date ?? body.sessionDate;
  if (requireAll || date !== undefined) {
    const formatted = TrainingSession.formatDate(date);
    if (!formatted) {
      return 'Fecha de sesión inválida.';
    }
  }
  return null;
}

function shouldRegenerateRecommendations(body) {
  const keys = ['duration_min', 'durationMin', 'intensity', 'type', 'sport_type', 'weather'];
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

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

    const validationError = validateTrainingFields(req.body, { requireAll: true });
    if (validationError) {
      return sendError(res, 400, validationError);
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
    const patch = { ...req.body };
    delete patch.userId;

    const validationError = validateTrainingFields(patch, { requireAll: false });
    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const updatedSession = await TrainingSession.updateSession(sessionId, patch);
    let recommendationsRegenerating = false;

    if (shouldRegenerateRecommendations(patch)) {
      recommendationsRegenerating = true;
      await Recommendation.deleteBySession(sessionId);
      const userId = req.user.id;
      TrainingRecommendationService.generateTrainingRecommendations(userId, sessionId, {
        type: updatedSession.type,
        intensity: updatedSession.intensity,
        durationMin: updatedSession.duration_min,
        weather: updatedSession.weather,
        sport_type: updatedSession.sport_type,
        notes: updatedSession.notes,
      }).catch((err) => console.error('Error regenerando recomendaciones:', err));
    }

    return sendSuccess(res, 200, {
      data: updatedSession,
      recommendationsRegenerating,
      message: 'Sesión de entrenamiento actualizada correctamente.',
    });
  } catch (error) {
    console.error('Error updating training session:', error);
    if (error.statusCode === 404) {
      return sendError(res, 404, 'Sesión no encontrada');
    }
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
