import { BaseModel } from './BaseModel.js';

class Recommendation extends BaseModel {
  static tableName = 'recommendations';

  // Obtener recomendaciones personalizadas
  static async getPersonalized(userId, limit = 5) {
    const [recommendations] = await this.pool.query(`
      SELECT r.*, 
             p.name as product_name, 
             p.price, 
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

      // Truncar el motivo si es demasiado largo (máx 250 caracteres)
      const MAX_FEEDBACK_LENGTH = 250;
      let feedback = reason || 'Recomendación personalizada';
      
      if (feedback.length > MAX_FEEDBACK_LENGTH) {
        console.warn(`El feedback excede el límite de ${MAX_FEEDBACK_LENGTH} caracteres. Truncando...`);
        feedback = feedback.substring(0, MAX_FEEDBACK_LENGTH - 3) + '...';
      }

      // Insertar la recomendación
      const [result] = await connection.query(
        `INSERT INTO recommendations 
        (user_id, session_id, product_id, feedback, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes, recommended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [userId, sessionId, productId, feedback, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes]
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

  // Registrar interacción con la recomendación
  static async logInteraction(userId, productId, action = 'view') {
    const [result] = await this.pool.query(
      `INSERT INTO recommendation_interactions 
        (user_id, product_id, action, created_at)
        VALUES (?, ?, ?, NOW())`,
      [userId, productId, action]
    );
    return result.insertId;
  }

  // Obtener productos recomendados basados en el perfil y entrenamiento
  static async getRecommendedProducts(userId, trainingData) {
    try {
      // Primero intentamos con productos no recomendados previamente
      let query = `
        SELECT p.* 
        FROM products p
        WHERE p.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM recommendations r 
          WHERE r.product_id = p.product_id 
          AND r.user_id = ?
        )
        ORDER BY RAND() 
        LIMIT 3`;

      const params = [userId];

      // Ejecutar la consulta
      const [products] = await this.pool.query(query, params);

      // Si no encontramos suficientes productos, buscamos cualquier producto activo
      if (!products || products.length < 3) {
        const [additionalProducts] = await this.pool.query(
          `SELECT p.* 
           FROM products p
           WHERE p.is_active = 1
           ORDER BY RAND() 
           LIMIT ?`,
          [3 - (products?.length || 0)]
        );
        
        if (additionalProducts && additionalProducts.length > 0) {
          products.push(...additionalProducts);
          // Asegurarnos de no exceder el límite
          if (products.length > 3) {
            products.length = 3;
          }
        }
      }

      // Asegurarnos de que los productos tengan la estructura esperada
      return (products || []).map(p => ({
        ...p,
        protein_g: p.protein_g || 0,
        carbs_g: p.carbs_g || 0,
        energy_kcal: p.energy_kcal || 0,
        caffeine_mg: p.caffeine_mg || 0,
        attributes: p.attributes ? (Array.isArray(p.attributes) ? p.attributes : [p.attributes]) : []
      }));
      
    } catch (error) {
      console.error('Error en getRecommendedProducts:', error);
      // En caso de error, devolver un array vacío
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