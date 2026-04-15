/**
 * Formato unificado de errores API: { success: false, message, details? }
 */
export function sendError(res, status, message, err = null) {
  const body = { success: false, message: message || 'Error en la solicitud' };
  if (process.env.NODE_ENV !== 'production' && err?.message) {
    body.details = err.message;
  }
  return res.status(status).json(body);
}

export function sendSuccess(res, status, payload = {}) {
  return res.status(status).json({ success: true, ...payload });
}
