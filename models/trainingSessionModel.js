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
  static sportTypeMap = {
    '10k': '10K',
    '15k': '15K',
    'media marathon': 'media marathon',
    'marathon': 'marathon',
    'trail': 'trail',
    'triathlon': 'Triathlon',
    'ciclismo de ruta': 'ciclismo de ruta',
    'ciclismo de montaña': 'ciclismo de montaña',
    'natacion': 'natacion',
  };

  // Función auxiliar para formatear la fecha al formato YYYY-MM-DD
  static formatDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // Devuelve solo la parte de la fecha (YYYY-MM-DD)
  }

  // Función para validar y mapear los valores de intensidad
  static mapIntensity(intensity) {
    if (!intensity) return 'medio';
    return this.intensityMap[intensity.toLowerCase()] || 'medio';
  }

  // Función para validar y mapear los valores de clima
  static mapWeather(weather) {
    if (!weather) return 'moderado';
    return this.weatherMap[weather.toLowerCase()] || 'moderado';
  }
  static mapSportType(sport_type) {
    if (!sport_type) return '10K';
    return this.sportTypeMap[sport_type.toLowerCase()] || '10K';
  }


  static async findByUserId(userId, limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const [rows] = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE user_id = ? ORDER BY session_date DESC LIMIT ?`,
      [userId, safeLimit]
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

  static async createSession({ userId, sessionDate, startTime, durationMin, intensity, type, weather, sport_type, notes }) {
    const formattedDate = this.formatDate(sessionDate);
    const mappedIntensity = this.mapIntensity(intensity);
    const mappedWeather = this.mapWeather(weather);
    const mappedSportType = this.mapSportType(sport_type);
    
    const [result] = await this.pool.query(
      `INSERT INTO ${this.tableName} (user_id, session_date, start_time, duration_min, intensity, type, weather, sport_type, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, formattedDate, startTime, durationMin, mappedIntensity, type, mappedWeather, mappedSportType, notes]
    );
    
    return this.findById(result.insertId);
  }

  static async updateSession(sessionId, { sessionDate, startTime, durationMin, intensity, type, weather, sport_type, notes }) {
    const formattedDate = this.formatDate(sessionDate);
    const mappedIntensity = this.mapIntensity(intensity);
    const mappedWeather = this.mapWeather(weather);
    const mappedSportType = this.mapSportType(sport_type);
    
    await this.pool.query(
      `UPDATE ${this.tableName} 
       SET session_date = ?, start_time = ?, duration_min = ?, intensity = ?, type = ?, weather = ?, sport_type = ?, notes = ?
       WHERE session_id = ?`,
      [formattedDate, startTime, durationMin, mappedIntensity, type, mappedWeather, mappedSportType, notes, sessionId]
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