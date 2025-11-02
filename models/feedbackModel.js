import { BaseModel } from './BaseModel.js';

class Feedback extends BaseModel {
  static tableName = 'user_product_feedback';

  // Guardar o actualizar feedback del usuario sobre un producto
  static async saveFeedback({ userId, productId, feedback, notes = null }) {
    try {
      const [result] = await this.pool.query(`
        INSERT INTO ${this.tableName} (user_id, product_id, feedback, notes)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          feedback = VALUES(feedback),
          notes = VALUES(notes),
          updated_at = CURRENT_TIMESTAMP
      `, [userId, productId, feedback, notes]);

      return {
        success: true,
        feedbackId: result.insertId || result.affectedRows,
        message: 'Feedback guardado correctamente'
      };
    } catch (error) {
      console.error('Error saving feedback:', error);
      throw error;
    }
  }

  // Obtener feedback del usuario para un producto específico
  static async getUserProductFeedback(userId, productId) {
    const [rows] = await this.pool.query(`
      SELECT * FROM ${this.tableName}
      WHERE user_id = ? AND product_id = ?
    `, [userId, productId]);
    
    return rows[0] || null;
  }

  // Obtener todos los productos con feedback negativo del usuario
  static async getNegativeFeedbackProducts(userId) {
    const [rows] = await this.pool.query(`
      SELECT product_id 
      FROM ${this.tableName}
      WHERE user_id = ? AND feedback = 'negativo'
    `, [userId]);
    
    return rows.map(row => row.product_id);
  }

  // Obtener todos los productos con feedback positivo del usuario
  static async getPositiveFeedbackProducts(userId) {
    const [rows] = await this.pool.query(`
      SELECT product_id 
      FROM ${this.tableName}
      WHERE user_id = ? AND feedback = 'positivo'
    `, [userId]);
    
    return rows.map(row => row.product_id);
  }

  // Obtener historial completo de feedback del usuario
  static async getUserFeedbackHistory(userId) {
    const [rows] = await this.pool.query(`
      SELECT f.*, p.name as product_name, p.image_url
      FROM ${this.tableName} f
      JOIN products p ON f.product_id = p.product_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `, [userId]);
    
    return rows;
  }

  // Eliminar feedback
  static async deleteFeedback(userId, productId) {
    const [result] = await this.pool.query(`
      DELETE FROM ${this.tableName}
      WHERE user_id = ? AND product_id = ?
    `, [userId, productId]);
    
    return result.affectedRows > 0;
  }
}

export default Feedback;

