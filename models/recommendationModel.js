import { BaseModel } from './BaseModel.js';

class Recommendation extends BaseModel {
  static tableName = 'recommendations';

  // Obtener recomendaciones personalizadas
  static async getPersonalized(userId, limit = 5) {
    const [recommendations] = await this.pool.query(`
      SELECT r.*, 
             p.name as product_name, 
             p.image_url, 
             p.description,
             r.consumption_timing,
             r.consumption_instructions,
             r.recommended_quantity,
             r.timing_minutes
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      WHERE r.user_id = ?
      ORDER BY r.recommended_at DESC
      LIMIT ?
    `, [userId, limit]);
    return recommendations;
  }

  // Obtener recomendaciones para un entrenamiento específico
  static async getByTrainingSession(userId, sessionId) {
    const [recommendations] = await this.pool.query(`
      SELECT r.*, 
             p.name as product_name, 
             p.image_url, 
             p.description,
             r.consumption_timing,
             r.consumption_instructions,
             r.recommended_quantity,
             r.timing_minutes
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      WHERE r.user_id = ? AND r.session_id = ?
      ORDER BY r.recommended_at DESC
    `, [userId, sessionId]);
    return recommendations;
  }

  // Crear una nueva recomendación
  static async createRecommendation({ userId, sessionId, productId, reason, score, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      // feedback es ENUM (positivo/neutral/negativo) — solo lo llena el usuario
      // feedback_notes almacena el razonamiento del LLM
      const MAX_NOTES_LENGTH = 500;
      let feedbackNotes = reason || 'Recomendación personalizada';
      
      if (feedbackNotes.length > MAX_NOTES_LENGTH) {
        console.warn(`El feedback_notes excede el límite de ${MAX_NOTES_LENGTH} caracteres. Truncando...`);
        feedbackNotes = feedbackNotes.substring(0, MAX_NOTES_LENGTH - 3) + '...';
      }

      // Insertar la recomendación
      const [result] = await connection.query(
        `INSERT INTO recommendations 
        (user_id, session_id, product_id, feedback, feedback_notes, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes, recommended_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NOW())`,
        [userId, sessionId, productId, feedbackNotes, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes]
      );

      // Obtener la recomendación recién creada con los datos del producto
      const [recommendations] = await connection.query(
        `SELECT r.*, 
                p.name as product_name, 
                p.description as product_description,
                p.image_url as product_image,
                r.consumption_timing,
                r.consumption_instructions,
                r.recommended_quantity,
                r.timing_minutes
         FROM recommendations r
         JOIN products p ON r.product_id = p.product_id
         WHERE r.recommendation_id = ?`,
        [result.insertId]
      );

      await connection.commit();
      return recommendations[0];
      
    } catch (error) {
      await connection.rollback();
      console.error('Error en createRecommendation:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Registrar interacción con la recomendación (reservado para uso futuro)
  static async logInteraction(userId, productId, action = 'view') {
    console.warn(
      `logInteraction no implementado: userId=${userId}, productId=${productId}, action=${action}`
    );
    return null;
  }

  // Obtener productos recomendados (sin ORDER BY RAND: paginación por offset derivado del usuario)
  static async getRecommendedProducts(userId, trainingData) {
    try {
      const uid = Number(userId) || 0;
      const sessionPart =
        trainingData && trainingData.sessionId != null ? Number(trainingData.sessionId) : 0;
      const seed = (uid * 7919 + sessionPart * 31) >>> 0;

      const notRecommendedSql = `p.is_active = 1 AND NOT EXISTS (
        SELECT 1 FROM recommendations r
        WHERE r.product_id = p.product_id
        AND r.user_id = ?
      )`;

      const [countRows] = await this.pool.query(
        `SELECT COUNT(*) as c FROM products p WHERE ${notRecommendedSql}`,
        [userId]
      );
      const totalFiltered = countRows[0]?.c || 0;
      let offset = 0;
      if (totalFiltered > 0) {
        const maxOff = Math.max(0, totalFiltered - 3);
        offset = maxOff > 0 ? seed % (maxOff + 1) : 0;
      }

      const [rows] = await this.pool.query(
        `SELECT p.* FROM products p
         WHERE ${notRecommendedSql}
         ORDER BY p.product_id ASC
         LIMIT 3 OFFSET ?`,
        [userId, offset]
      );

      let list = rows || [];
      const existingIds = new Set(list.map((p) => p.product_id));

      if (list.length < 3) {
        const need = 3 - list.length;
        const [countAll] = await this.pool.query(
          `SELECT COUNT(*) as c FROM products p WHERE p.is_active = 1`
        );
        const totalAll = countAll[0]?.c || 0;
        const maxOff2 = Math.max(0, totalAll - (need + 2));
        const offset2 = maxOff2 > 0 ? (seed ^ 0x9e3779b9) % (maxOff2 + 1) : 0;
        const [additional] = await this.pool.query(
          `SELECT p.* FROM products p
           WHERE p.is_active = 1
           ORDER BY p.product_id ASC
           LIMIT ? OFFSET ?`,
          [need + 8, offset2]
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
    const [result] = await this.pool.query(
      `UPDATE recommendations 
       SET feedback = ?, feedback_notes = ? 
       WHERE recommendation_id = ?`,
      [feedback, notes, recommendationId]
    );
    return result.affectedRows > 0;
  }
}

export default Recommendation;