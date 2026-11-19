import { BaseModel } from './BaseModel.js';
import { withTransaction } from '../config/db.js';

/**
 * Evidencia de una recomendación para mostrar al usuario: título, año, tipo, resumen y DOI/URL.
 * No expone datos técnicos (similitud, score, embeddings).
 */
const EVIDENCE_JSON = `
  COALESCE((
    SELECT json_agg(json_build_object(
             'source_id', s.source_id, 'title', s.title, 'year', s.year, 'source_type', s.source_type,
             'source_category', s.source_category, 'summary', c.result_summary, 'doi', s.doi, 'url', s.url,
             'role', re.role)
           ORDER BY re.rank NULLS LAST, re.recommendation_evidence_id)
      FROM (SELECT DISTINCT ON (x.claim_id, x.role) x.* FROM recommendation_evidence x
             WHERE x.recommendation_id = r.recommendation_id AND x.role IN ('supports','caveat','usage_constraint')
             ORDER BY x.claim_id, x.role, x.rank NULLS LAST) re
      JOIN evidence_sources s ON s.source_id = re.source_id
      LEFT JOIN evidence_claims c ON c.claim_id = re.claim_id
  ), '[]'::json) AS evidence`;

class Recommendation extends BaseModel {
  static tableName = 'recommendations';
  static primaryKey = 'recommendation_id';

  // Obtener recomendaciones para un entrenamiento específico
  static async getByTrainingSession(userId, sessionId) {
    const { rows } = await this.pool.query(`
      SELECT r.*,
             p.name as product_name,
             p.image_url,
             p.description,
             r.consumption_timing,
             r.consumption_instructions,
             r.recommended_quantity,
             r.timing_minutes,
             ${EVIDENCE_JSON}
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      WHERE r.user_id = $1 AND r.session_id = $2
      ORDER BY r.recommended_at DESC, r.recommendation_id ASC
    `, [userId, sessionId]);
    return rows;
  }

  static async deleteBySession(sessionId) {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE session_id = $1`, [sessionId]);
  }

  static VALID_TIMINGS = ['antes', 'durante', 'despues', 'diario'];

  /** Normaliza los valores que llegan del LLM a las restricciones de la tabla. */
  static normalizeRecommendationInput({ reason, consumption_timing, recommended_quantity, timing_minutes, ...rest }) {
    // feedback (positivo/neutral/negativo) — solo lo llena el usuario
    // feedback_notes almacena el razonamiento del LLM
    const MAX_NOTES_LENGTH = 500;
    let feedbackNotes = reason || 'Recomendación personalizada';
    if (feedbackNotes.length > MAX_NOTES_LENGTH) {
      console.warn(`El feedback_notes excede el límite de ${MAX_NOTES_LENGTH} caracteres. Truncando...`);
      feedbackNotes = feedbackNotes.substring(0, MAX_NOTES_LENGTH - 3) + '...';
    }

    // recommended_quantity es varchar(100): MariaDB (modo no estricto) truncaba en silencio, PostgreSQL falla.
    const MAX_QUANTITY_LENGTH = 100;
    const quantity =
      typeof recommended_quantity === 'string' && recommended_quantity.length > MAX_QUANTITY_LENGTH
        ? recommended_quantity.substring(0, MAX_QUANTITY_LENGTH)
        : recommended_quantity;

    // consumption_timing tiene CHECK: un valor inesperado del LLM se guarda como NULL en vez de abortar.
    const timing = this.VALID_TIMINGS.includes(consumption_timing) ? consumption_timing : null;
    const minutes = Number.isInteger(Number(timing_minutes)) && timing_minutes !== null && timing_minutes !== ''
      ? Number(timing_minutes)
      : null;

    return { ...rest, feedbackNotes, quantity, timing, minutes };
  }

  static async insertRecommendation(client, input) {
    const { userId, sessionId, productId, feedbackNotes, timing, consumption_instructions, quantity, minutes,
      evidence_mode = 'legacy', cadence_status = null, evidence_note = null, evidence = [] } =
      this.normalizeRecommendationInput(input);
    const { rows } = await client.query(
      `INSERT INTO recommendations
      (user_id, session_id, product_id, feedback, feedback_notes, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes, recommended_at,
       evidence_mode, cadence_status, evidence_note)
      VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)
      RETURNING recommendation_id`,
      [userId, sessionId, productId, feedbackNotes, timing, consumption_instructions, quantity, minutes,
       evidence_mode, cadence_status, evidence_note ? String(evidence_note).slice(0, 1000) : null]
    );
    const recommendationId = rows[0].recommendation_id;
    for (const e of evidence) {
      await client.query(
        `INSERT INTO recommendation_evidence (recommendation_id, source_id, claim_id, chunk_id, relation_type, role, similarity, score, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ON CONSTRAINT recommendation_evidence_unique DO NOTHING`,
        [recommendationId, e.source_id, e.claim_id ?? null, e.chunk_id ?? null, e.relation_type, e.role,
         e.similarity ?? null, e.score ?? null, e.rank ?? null]
      );
    }
    return recommendationId;
  }

  static async selectWithProduct(client, recommendationIds) {
    const { rows } = await client.query(
      `SELECT r.*,
              p.name as product_name,
              p.description as product_description,
              p.image_url as product_image,
              r.consumption_timing,
              r.consumption_instructions,
              r.recommended_quantity,
              r.timing_minutes,
              ${EVIDENCE_JSON}
       FROM recommendations r
       JOIN products p ON r.product_id = p.product_id
       WHERE r.recommendation_id = ANY($1::int[])
       ORDER BY array_position($1::int[], r.recommendation_id)`,
      [recommendationIds]
    );
    return rows;
  }

  // Crear una nueva recomendación
  static async createRecommendation(input) {
    try {
      return await withTransaction(async (client) => {
        const id = await this.insertRecommendation(client, input);
        const [recommendation] = await this.selectWithProduct(client, [id]);
        return recommendation;
      });
    } catch (error) {
      console.error('Error en createRecommendation:', error);
      throw error;
    }
  }

  /**
   * Crea todas las recomendaciones de una sesión en UNA transacción: quien consulte la sesión
   * ve 0 o todas, nunca un estado parcial (antes se insertaban una a una y el frontend podía
   * mostrar solo 1–3 productos al sondear durante la regeneración).
   * Si una inserción falla, se descarta solo esa (SAVEPOINT) y se conservan las demás.
   */
  static async createRecommendationsBatch(inputs) {
    if (!inputs || inputs.length === 0) return [];
    try {
      return await withTransaction(async (client) => {
        const ids = [];
        for (const input of inputs) {
          await client.query('SAVEPOINT rec_item');
          try {
            ids.push(await this.insertRecommendation(client, input));
            await client.query('RELEASE SAVEPOINT rec_item');
          } catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT rec_item');
            console.error(`Error creando recomendación para producto ${input.productId}:`, error.message);
          }
        }
        return ids.length ? this.selectWithProduct(client, ids) : [];
      });
    } catch (error) {
      console.error('Error en createRecommendationsBatch:', error);
      throw error;
    }
  }

  // Obtener productos recomendados (sin ORDER BY RAND: paginación por offset derivado del usuario)
  static async getRecommendedProducts(userId, trainingData) {
    try {
      const uid = Number(userId) || 0;
      const sessionPart =
        trainingData && trainingData.sessionId != null ? Number(trainingData.sessionId) : 0;
      const seed = (uid * 7919 + sessionPart * 31) >>> 0;

      const notRecommendedSql = `p.is_active = TRUE AND NOT EXISTS (
        SELECT 1 FROM recommendations r
        WHERE r.product_id = p.product_id
        AND r.user_id = $1
      )`;

      const { rows: countRows } = await this.pool.query(
        `SELECT COUNT(*)::int as c FROM products p WHERE ${notRecommendedSql}`,
        [userId]
      );
      const totalFiltered = countRows[0]?.c || 0;
      let offset = 0;
      if (totalFiltered > 0) {
        const maxOff = Math.max(0, totalFiltered - 3);
        offset = maxOff > 0 ? seed % (maxOff + 1) : 0;
      }

      const { rows } = await this.pool.query(
        `SELECT p.* FROM products p
         WHERE ${notRecommendedSql}
         ORDER BY p.product_id ASC
         LIMIT 3 OFFSET $2`,
        [userId, offset]
      );

      let list = rows || [];
      const existingIds = new Set(list.map((p) => p.product_id));

      if (list.length < 3) {
        const need = 3 - list.length;
        const { rows: countAll } = await this.pool.query(
          `SELECT COUNT(*)::int as c FROM products p WHERE p.is_active = TRUE`
        );
        const totalAll = countAll[0]?.c || 0;
        const maxOff2 = Math.max(0, totalAll - (need + 2));
        const offset2 = maxOff2 > 0 ? (seed ^ 0x9e3779b9) % (maxOff2 + 1) : 0;
        const { rows: additional } = await this.pool.query(
          `SELECT p.* FROM products p
           WHERE p.is_active = TRUE
           ORDER BY p.product_id ASC
           LIMIT $1 OFFSET $2`,
          [need + 8, Math.abs(offset2)]
        );
        for (const p of additional || []) {
          if (list.length >= 3) break;
          if (!existingIds.has(p.product_id)) {
            existingIds.add(p.product_id);
            list.push(p);
          }
        }
      }

      if (list.length > 3) list = list.slice(0, 3);

      return list.map((p) => ({
        ...p,
        protein_g: p.protein_g || 0,
        carbs_g: p.carbs_g || 0,
        energy_kcal: p.energy_kcal || 0,
        caffeine_mg: p.caffeine_mg || 0,
        attributes: p.attributes
          ? Array.isArray(p.attributes)
            ? p.attributes
            : [p.attributes]
          : [],
      }));
    } catch (error) {
      console.error('Error en getRecommendedProducts:', error);
      return [];
    }
  }

  // Actualizar feedback de una recomendación
  static async updateFeedback(recommendationId, feedback, notes = null) {
    const result = await this.pool.query(
      `UPDATE recommendations
       SET feedback = $1, feedback_notes = $2
       WHERE recommendation_id = $3`,
      [feedback, notes, recommendationId]
    );
    return result.rowCount > 0;
  }
}

export default Recommendation;
