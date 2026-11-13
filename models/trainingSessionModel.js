import { BaseModel } from './BaseModel.js';
import { withTransaction } from '../config/db.js';

class TrainingSession extends BaseModel {
  static tableName = 'training_sessions';
  static primaryKey = 'session_id';

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
  // Tipos de entrenamiento válidos (CHECK en PostgreSQL). MariaDB en modo no estricto
  // guardaba '' ante un valor desconocido; PostgreSQL lo rechaza, así que se mapea a 'otro'.
  static validTypes = ['cardio', 'fuerza', 'hiit', 'resistencia', 'mixed', 'otro'];

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

  // Valores tal como se guardan en la BD (CHECK). Al editar, la app puede reenviar estos valores ya
  // normalizados (p. ej. 'calido'); antes no estaban en el mapa y se convertían en el valor por defecto.
  static dbIntensities = ['bajo', 'medio', 'alto', 'muy alto'];
  static dbWeathers = ['frio', 'fresco', 'moderado', 'calido', 'caliente', 'humedo'];

  // Función para validar y mapear los valores de intensidad
  static mapIntensity(intensity) {
    if (!intensity) return 'medio';
    const value = String(intensity).toLowerCase().trim();
    if (this.dbIntensities.includes(value)) return value;
    return this.intensityMap[value] || 'medio';
  }

  // Función para validar y mapear los valores de clima
  static mapWeather(weather) {
    if (!weather) return 'moderado';
    const value = String(weather).toLowerCase().trim();
    if (this.dbWeathers.includes(value)) return value;
    return this.weatherMap[value] || 'moderado';
  }
  static mapType(type) {
    if (type === undefined || type === null || type === '') return null;
    const normalized = String(type).toLowerCase().trim();
    return this.validTypes.includes(normalized) ? normalized : 'otro';
  }

  static mapSportType(sport_type) {
    if (!sport_type) return '10K';
    return this.sportTypeMap[sport_type.toLowerCase()] || '10K';
  }

  /**
   * Campos que influyen en las recomendaciones cuyo valor REAL (ya normalizado) cambia con el patch.
   * Antes bastaba con que la clave viniera en el cuerpo para borrar y regenerar todo.
   */
  static changedRecommendationFields(current, patch = {}) {
    const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
    const changes = [];
    if (has('duration_min') || has('durationMin')) {
      const next = parseInt(patch.duration_min ?? patch.durationMin, 10);
      if (next !== Number(current.duration_min)) changes.push('duration_min');
    }
    if (has('intensity') && this.mapIntensity(patch.intensity) !== current.intensity) changes.push('intensity');
    if (has('type') && this.mapType(patch.type) !== current.type) changes.push('type');
    if (has('sport_type') && this.mapSportType(patch.sport_type) !== current.sport_type) changes.push('sport_type');
    if (has('weather') && this.mapWeather(patch.weather) !== current.weather) changes.push('weather');
    return changes;
  }


  static async findByUserId(userId, limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE user_id = $1 ORDER BY session_date DESC, session_id DESC LIMIT $2`,
      [userId, safeLimit]
    );
    return rows;
  }

  static async findById(sessionId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE session_id = $1`,
      [sessionId]
    );
    return rows[0];
  }

  static async createSession({ userId, sessionDate, startTime, durationMin, intensity, type, weather, sport_type, notes }) {
    const formattedDate = this.formatDate(sessionDate);
    const mappedIntensity = this.mapIntensity(intensity);
    const mappedWeather = this.mapWeather(weather);
    const mappedSportType = this.mapSportType(sport_type);
    const mappedType = this.mapType(type);

    const { rows } = await this.pool.query(
      `INSERT INTO ${this.tableName} (user_id, session_date, start_time, duration_min, intensity, type, weather, sport_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING session_id`,
      [userId, formattedDate, startTime, durationMin, mappedIntensity, mappedType, mappedWeather, mappedSportType, notes]
    );

    return this.findById(rows[0].session_id);
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
      type: has('type') ? this.mapType(patch.type) : current.type,
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
      values.push(next.session_date);
      sets.push(`session_date = $${values.length}`);
    }
    if (has('startTime') || has('start_time')) {
      values.push(next.start_time);
      sets.push(`start_time = $${values.length}`);
    }
    if (has('durationMin') || has('duration_min')) {
      values.push(next.duration_min);
      sets.push(`duration_min = $${values.length}`);
    }
    if (has('intensity')) {
      values.push(next.intensity);
      sets.push(`intensity = $${values.length}`);
    }
    if (has('type')) {
      values.push(next.type);
      sets.push(`type = $${values.length}`);
    }
    if (has('weather')) {
      values.push(next.weather);
      sets.push(`weather = $${values.length}`);
    }
    if (has('sport_type')) {
      values.push(next.sport_type);
      sets.push(`sport_type = $${values.length}`);
    }
    if (has('notes')) {
      values.push(next.notes);
      sets.push(`notes = $${values.length}`);
    }

    if (sets.length === 0) {
      return current;
    }

    values.push(sessionId);
    await this.pool.query(
      `UPDATE ${this.tableName} SET ${sets.join(', ')} WHERE session_id = $${values.length}`,
      values
    );

    return this.findById(sessionId);
  }

  static async deleteSession(sessionId) {
    try {
      await withTransaction(async (client) => {
        // Primero eliminar las recomendaciones asociadas
        await client.query(`DELETE FROM recommendations WHERE session_id = $1`, [sessionId]);
        // Luego eliminar el entrenamiento
        await client.query(`DELETE FROM ${this.tableName} WHERE session_id = $1`, [sessionId]);
      });
      return { success: true };
    } catch (error) {
      console.error('Error deleting training session:', error);
      throw error;
    }
  }
}

export default TrainingSession;