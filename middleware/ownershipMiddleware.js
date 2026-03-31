import TrainingSession from '../models/trainingSessionModel.js';

/**
 * Exige que req.params.userId (o el nombre indicado) coincida con req.user.id (JWT).
 */
export function requireMatchingUserId(paramName = 'userId') {
  return (req, res, next) => {
    const id = parseInt(req.params[paramName], 10);
    if (isNaN(id) || !req.user || req.user.id !== id) {
      return res.status(403).json({ message: 'Acceso denegado' });
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
      return res.status(400).json({ message: 'ID de sesión inválido' });
    }
    const session = await TrainingSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Sesión no encontrada' });
    }
    if (parseInt(session.user_id, 10) !== req.user.id) {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
    req.trainingSession = session;
    next();
  } catch (err) {
    console.error('requireTrainingSessionOwner:', err);
    res.status(500).json({ message: 'Error al verificar la sesión' });
  }
}
