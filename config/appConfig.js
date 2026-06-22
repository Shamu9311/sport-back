/**
 * Configuración centralizada (JWT, CORS, etc.)
 * Evita inconsistencias entre firma y verificación del token.
 */
import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

const DEFAULT_DEV_SECRET = 'default-secret-key-change-in-production';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim() !== '') {
    return secret;
  }
  if (isProduction) {
    throw new Error(
      'JWT_SECRET es obligatorio en producción. Defínalo en las variables de entorno.'
    );
  }
  console.warn(
    '[appConfig] JWT_SECRET no definido; usando secreto de desarrollo. No use esto en producción.'
  );
  return DEFAULT_DEV_SECRET;
}

/** Secreto resuelto una sola vez al cargar el módulo */
export const JWT_SECRET = getJwtSecret();

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * CORS: lista en CORS_ORIGIN separada por comas. Si está vacía, refleja cualquier origen (útil en dev / Expo).
 * Peticiones sin cabecera Origin (p. ej. apps nativas) se permiten siempre.
 */
export function getCorsOptions() {
  const raw = process.env.CORS_ORIGIN;
  const allowedList = raw
    ? raw.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  if (allowedList.length === 0) {
    if (isProduction) {
      throw new Error(
        'CORS_ORIGIN es obligatorio en producción. Defínalo en las variables de entorno.'
      );
    }
    return { origin: true, credentials: true };
  }

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedList.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };
}
