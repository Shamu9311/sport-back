import { BaseModel } from './BaseModel.js';

class TrainingSession extends BaseModel {
  static tableName = 'training_sessions';

  // Mapeo de valores de intensidad
  static intensityMap = {
    'baja': 'bajo',
    'media': 'medio',
    'alta': 'alto',
    'muy alta': 'muy alto'
  };

  // Mapeo de valores de clima
  static weatherMap = {
    'soleado': 'calido',
    'nublado': 'moderado',
    'lluvia': 'humedo',
    'fresco': 'fresco',
    'caluroso': 'caliente',
    'húmedo': 'humedo'
  };

  // Función auxiliar para formatear la fecha al formato YYYY-MM-DD
  static formatDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // Devuelve solo la parte de la fecha (YYYY-MM-DD)
  }

  // Función para validar y mapear los valores de intensidad
  static mapIntensity(intensity) {
    return this.intensityMap[intensity.toLowerCase()] || 'medio'; // Valor por defecto 'medio'
  }

  // Función para validar y mapear los valores de clima
  static mapWeather(weather) {
    return this.weatherMap[weather.toLowerCase()] || 'moderado'; // Valor por defecto 'moderado'
  }


  static async findByUserId(userId) {
    const [rows] = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE user_id = ? ORDER BY session_date DESC`,
      [userId]
    );
    return rows;
  }

  static async findById(sessionId) {
    const [rows] = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE session_id = ?`,
      [sessionId]
    );
    return rows[0];
  }

  static async createSession({ userId, sessionDate, durationMin, intensity, type, weather, notes }) {
    const formattedDate = this.formatDate(sessionDate);
    const mappedIntensity = this.mapIntensity(intensity);
    const mappedWeather = this.mapWeather(weather);
    
    const [result] = await this.pool.query(
      `INSERT INTO ${this.tableName} (user_id, session_date, duration_min, intensity, type, weather, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, formattedDate, durationMin, mappedIntensity, type, mappedWeather, notes]
    );
    
    return this.findById(result.insertId);
  }

  static async updateSession(sessionId, { sessionDate, durationMin, intensity, type, weather, notes }) {
    const formattedDate = this.formatDate(sessionDate);
    const mappedIntensity = this.mapIntensity(intensity);
    const mappedWeather = this.mapWeather(weather);
    
    await this.pool.query(
      `UPDATE ${this.tableName} 
       SET session_date = ?, duration_min = ?, intensity = ?, type = ?, weather = ?, notes = ?
       WHERE session_id = ?`,
      [formattedDate, durationMin, mappedIntensity, type, mappedWeather, notes, sessionId]
    );
    
    return this.findById(sessionId);
  }

  static async deleteSession(sessionId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // Primero eliminar las recomendaciones asociadas
      await connection.query(
        `DELETE FROM recommendations WHERE session_id = ?`,
        [sessionId]
      );
      
      // Luego eliminar el entrenamiento
      await connection.query(
        `DELETE FROM ${this.tableName} WHERE session_id = ?`,
        [sessionId]
      );
      
      await connection.commit();
      return { success: true };
      
    } catch (error) {
      await connection.rollback();
      console.error('Error deleting training session:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export default TrainingSession;