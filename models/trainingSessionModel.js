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
    const raw = String(dateString).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
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

  static async updateSession(sessionId, patch = {}) {
    const current = await this.findById(sessionId);
    if (!current) {
      const err = new Error('Sesión no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);

    const next = {
      session_date: has('sessionDate') || has('session_date')
        ? this.formatDate(patch.sessionDate ?? patch.session_date)
        : current.session_date,
      start_time: has('startTime') || has('start_time')
        ? patch.startTime ?? patch.start_time
        : current.start_time,
      duration_min: has('durationMin') || has('duration_min')
        ? patch.durationMin ?? patch.duration_min
        : current.duration_min,
      intensity: has('intensity')
        ? this.mapIntensity(patch.intensity)
        : current.intensity,
      type: has('type') ? patch.type : current.type,
      weather: has('weather')
        ? this.mapWeather(patch.weather)
        : current.weather,
      sport_type: has('sport_type')
        ? this.mapSportType(patch.sport_type)
        : current.sport_type,
      notes: has('notes') ? patch.notes : current.notes,
    };

    const sets = [];
    const values = [];
    if (has('sessionDate') || has('session_date')) {
      sets.push('session_date = ?');
      values.push(next.session_date);
    }
    if (has('startTime') || has('start_time')) {
      sets.push('start_time = ?');
      values.push(next.start_time);
    }
    if (has('durationMin') || has('duration_min')) {
      sets.push('duration_min = ?');
      values.push(next.duration_min);
    }
    if (has('intensity')) {
      sets.push('intensity = ?');
      values.push(next.intensity);
    }
    if (has('type')) {
      sets.push('type = ?');
      values.push(next.type);
    }
    if (has('weather')) {
      sets.push('weather = ?');
      values.push(next.weather);
    }
    if (has('sport_type')) {
      sets.push('sport_type = ?');
      values.push(next.sport_type);
    }
    if (has('notes')) {
      sets.push('notes = ?');
      values.push(next.notes);
    }

    if (sets.length === 0) {
      return current;
    }

    values.push(sessionId);
    await this.pool.query(
      `UPDATE ${this.tableName} SET ${sets.join(', ')} WHERE session_id = ?`,
      values
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