import TrainingSession from '../models/trainingSessionModel.js';
import { sendError } from '../utils/apiResponse.js';

/**
 * Exige que req.params.userId (o el nombre indicado) coincida con req.user.id (JWT).
 */
export function requireMatchingUserId(paramName = 'userId') {
  return (req, res, next) => {
    const id = parseInt(req.params[paramName], 10);
    if (isNaN(id) || !req.user || req.user.id !== id) {
      return sendError(res, 403, 'Acceso denegado');
    }
    next();
  };
}

/**
 * Para rutas /training/:id/... — la sesión debe pertenecer al usuario autenticado.
 */
export async function requireTrainingSessionOwner(req, res, next) {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return sendError(res, 400, 'ID de sesión inválido');
    }
    const session = await TrainingSession.findById(sessionId);
    if (!session) {
      return sendError(res, 404, 'Sesión no encontrada');
    }
    if (parseInt(session.user_id, 10) !== req.user.id) {
      return sendError(res, 403, 'Acceso denegado');
    }
    req.trainingSession = session;
    next();
  } catch (err) {
    console.error('requireTrainingSessionOwner:', err);
    return sendError(res, 500, 'Error al verificar la sesión', err);
  }
}
