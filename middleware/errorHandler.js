import { sendError } from '../utils/apiResponse.js';

/**
 * Middleware Express: rutas no encontradas (sin `err`)
 */
export function notFoundHandler(req, res) {
  return sendError(res, 404, 'Ruta no encontrada');
}

/**
 * Middleware de errores (4 argumentos)
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  console.error('[errorHandler]', err);
  const status = err.status || err.statusCode || 500;
  const message =
    status === 500 && process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message || 'Error interno del servidor';
  return sendError(res, status, message, err);
}
