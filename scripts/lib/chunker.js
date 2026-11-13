// scripts/lib/chunker.js — Preparación de fragmentos (chunks) de evidencia.
//
// Los chunks llegan CURADOS en el manifiesto (sección, encabezado, página). El script no extrae PDFs.
// Solo si un fragmento es demasiado largo se divide por PÁRRAFOS dentro del mismo encabezado
// (nunca a mitad de frase ni cruzando secciones), conservando su procedencia.
import crypto from 'crypto';

export const MAX_TOKENS_PER_CHUNK = 600;
export const TARGET_TOKENS_PER_CHUNK = 450;

/** Normalización estable para el hash: Unicode NFC, espacios colapsados, sin espacios en los extremos. */
export function normalizeContent(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function contentHash(text) {
  return crypto.createHash('sha256').update(normalizeContent(text), 'utf8').digest('hex');
}

/** Estimación simple de tokens (≈ 1.3 tokens por palabra), suficiente para decidir divisiones. */
export function estimateTokens(text) {
  const words = normalizeContent(text).split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function splitByParagraphs(content) {
  const paragraphs = normalizeContent(content).split('\n\n');
  const parts = [];
  let current = [];
  let tokens = 0;
  for (const p of paragraphs) {
    const t = estimateTokens(p);
    if (current.length && tokens + t > TARGET_TOKENS_PER_CHUNK) {
      parts.push(current.join('\n\n'));
      current = [];
      tokens = 0;
    }
    current.push(p);
    tokens += t;
  }
  if (current.length) parts.push(current.join('\n\n'));
  return parts;
}

/**
 * Convierte los chunks del manifiesto en filas listas para insertar.
 * @returns {{ rows: object[], keyMap: Map<string, string[]> }} keyMap: chunk_key original → claves finales
 */
export function prepareChunks(manifestChunks = []) {
  const rows = [];
  const keyMap = new Map();
  for (const chunk of manifestChunks) {
    const content = normalizeContent(chunk.content);
    const pieces = estimateTokens(content) > MAX_TOKENS_PER_CHUNK ? splitByParagraphs(content) : [content];
    const keys = [];
    pieces.forEach((piece, i) => {
      const key = pieces.length > 1 ? `${chunk.chunk_key}.${i + 1}` : chunk.chunk_key;
      keys.push(key);
      rows.push({
        chunk_key: key,
        chunk_index: rows.length,
        section: chunk.section,
        heading: chunk.heading || null,
        page: chunk.page || null,
        paragraph: chunk.paragraph || null,
        content: piece,
        content_kind: chunk.content_kind || 'excerpt',
        content_hash: contentHash(piece),
        token_count: estimateTokens(piece),
      });
    });
    keyMap.set(chunk.chunk_key, keys);
  }
  return { rows, keyMap };
}
