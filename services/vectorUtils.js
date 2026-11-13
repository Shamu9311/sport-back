// services/vectorUtils.js — Utilidades de vectores sin dependencias de BD (usables desde scripts y tests).

export const EMBEDDING_DIMENSIONS = 768;

// Calcular similitud coseno entre dos vectores (utilidad en JS; la búsqueda real ocurre en PostgreSQL)
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    console.error('Invalid vectors for similarity calculation');
    return 0;
  }

  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Serializa un array de floats al formato de texto de pgvector: '[0.1,0.2,...]'.
 * Valida dimensión y valores finitos para no enviar vectores corruptos a la BD.
 */
export function toPgVector(values, dimensions = EMBEDDING_DIMENSIONS) {
  if (!Array.isArray(values) && !(values instanceof Float32Array)) {
    throw new Error('El embedding debe ser un array de números.');
  }
  if (values.length !== dimensions) {
    throw new Error(`El embedding debe tener ${dimensions} dimensiones (recibido: ${values.length}).`);
  }
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('El embedding contiene valores no numéricos o no finitos.');
    }
  }
  return `[${Array.from(values).join(',')}]`;
}

/** Convierte el texto devuelto por pgvector ('[0.1,0.2,...]') en array de números. */
export function fromPgVector(text) {
  if (Array.isArray(text)) return text;
  if (typeof text !== 'string') return null;
  return JSON.parse(text);
}
