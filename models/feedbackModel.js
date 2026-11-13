import { BaseModel } from './BaseModel.js';

class Feedback extends BaseModel {
  static tableName = 'user_product_feedback';
  static primaryKey = 'feedback_id';

  // Guardar o actualizar feedback del usuario sobre un producto
  static async saveFeedback({ userId, productId, feedback, notes = null }) {
    try {
      // updated_at lo actualiza el trigger set_updated_at() en la rama UPDATE del ON CONFLICT
      const result = await this.pool.query(`
        INSERT INTO ${this.tableName} (user_id, product_id, feedback, notes)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, product_id) DO UPDATE SET
          feedback = EXCLUDED.feedback,
          notes = EXCLUDED.notes
        RETURNING feedback_id
      `, [userId, productId, feedback, notes]);

      return {
        success: true,
        feedbackId: result.rows[0]?.feedback_id || result.rowCount,
        message: 'Feedback guardado correctamente'
      };
    } catch (error) {
      console.error('Error saving feedback:', error);
      throw error;
    }
  }

  // Obtener feedback del usuario para un producto específico
  static async getUserProductFeedback(userId, productId) {
    const { rows } = await this.pool.query(`
      SELECT * FROM ${this.tableName}
      WHERE user_id = $1 AND product_id = $2
    `, [userId, productId]);

    return rows[0] || null;
  }

  // Obtener todos los productos con feedback negativo del usuario
  static async getNegativeFeedbackProducts(userId) {
    const { rows } = await this.pool.query(`
      SELECT product_id
      FROM ${this.tableName}
      WHERE user_id = $1 AND feedback = 'negativo'
    `, [userId]);

    return rows.map(row => row.product_id);
  }

  // Obtener todos los productos con feedback positivo del usuario
  static async getPositiveFeedbackProducts(userId) {
    const { rows } = await this.pool.query(`
      SELECT product_id
      FROM ${this.tableName}
      WHERE user_id = $1 AND feedback = 'positivo'
    `, [userId]);

    return rows.map(row => row.product_id);
  }

  // Obtener historial completo de feedback del usuario
  static async getUserFeedbackHistory(userId, limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const { rows } = await this.pool.query(`
      SELECT f.*, p.name as product_name, p.image_url
      FROM ${this.tableName} f
      JOIN products p ON f.product_id = p.product_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      LIMIT $2
    `, [userId, safeLimit]);

    return rows;
  }

  // Eliminar feedback
  static async deleteFeedback(userId, productId) {
    const result = await this.pool.query(`
      DELETE FROM ${this.tableName}
      WHERE user_id = $1 AND product_id = $2
    `, [userId, productId]);

    return result.rowCount > 0;
  }
}

export default Feedback;
