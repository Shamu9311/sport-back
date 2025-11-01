import { BaseModel } from './BaseModel.js';
import { pool } from '../config/db.js';

class User extends BaseModel {
  static tableName = 'users';
  static primaryKey = 'user_id'; // Especificar que la clave primaria es user_id, no id

  static async findByEmail(email) {
    const [rows] = await this.pool.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  }

  static async create({ username, email, password }) {
    const [result] = await this.pool.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, password]
    );
    return this.findById(result.insertId);
  }

  static async createUserProfile(userId, profileData) {
    try {
      // Verificar si ya existe un perfil para este usuario
      const [existingProfile] = await this.pool.query(
        'SELECT * FROM user_profiles WHERE user_id = ?',
        [userId]
      );
      
      // Extraer los campos correctos del profileData
      let {
        age,
        weight,
        height,
        gender,
        activity_level,
        training_frequency,
        primary_goal,
        sweat_level,
        caffeine_tolerance,
        dietary_restrictions
      } = profileData;
      
      // Mapear los valores a los ENUMs aceptados por la base de datos
      
      // Gender: ENUM('hombre', 'mujer', 'otro', 'prefiero no decir')
      if (gender === 'M' || gender === 'male') {
        gender = 'hombre';
      } else if (gender === 'F' || gender === 'female') {
        gender = 'mujer';
      } else if (!gender || !['hombre', 'mujer', 'otro', 'prefiero no decir'].includes(gender.toLowerCase())) {
        gender = 'otro'; // Solo usa 'otro' si el valor no es válido
      }
      // Si ya es 'hombre', 'mujer', 'otro' o 'prefiero no decir', lo deja como está
      
      // Activity Level: ENUM('sedentario', '', 'moderado', 'activo', 'muy activo')
      if (activity_level === 'sedentary') {
        activity_level = 'sedentario';
      } else if (activity_level === 'moderate') {
        activity_level = 'moderado';
      } else if (activity_level === 'active') {
        activity_level = 'activo';
      } else if (activity_level === 'very_active') {
        activity_level = 'muy activo';
      }
      
      // Training Frequency: ENUM('1-2', '3-4', '5+', 'ocacional')
      // Los valores ya coinciden excepto 'ocacional' que no se usa
      
      // Primary Goal: ENUM('mejor rendimiento', 'perder peso', 'ganar musculo', 'resistencia', 'recuperacion', 'por salud')
      if (primary_goal === 'performance') {
        primary_goal = 'mejor rendimiento';
      } else if (primary_goal === 'weight_loss') {
        primary_goal = 'perder peso';
      } else if (primary_goal === 'muscle_gain') {
        primary_goal = 'ganar musculo';
      } else if (primary_goal === 'general_health') {
        primary_goal = 'por salud';
      }
      
      // Sweat Level: ENUM('bajo', 'medio', 'alto')
      if (sweat_level === 'low') {
        sweat_level = 'bajo';
      } else if (sweat_level === 'medium') {
        sweat_level = 'medio';
      } else if (sweat_level === 'high') {
        sweat_level = 'alto';
      }
      
      // Caffeine Tolerance: ENUM('no', 'bajo', 'medio', 'alto')
      if (caffeine_tolerance === 'none') {
        caffeine_tolerance = 'no';
      } else if (caffeine_tolerance === 'low') {
        caffeine_tolerance = 'bajo';
      } else if (caffeine_tolerance === 'medium') {
        caffeine_tolerance = 'medio';
      } else if (caffeine_tolerance === 'high') {
        caffeine_tolerance = 'alto';
      }
      
      console.log('Valores mapeados para la base de datos:', {
        gender,
        activity_level,
        training_frequency,
        primary_goal,
        sweat_level,
        caffeine_tolerance
      });
      
      // Asegurar que dietary_restrictions sea un valor válido del ENUM
      if (Array.isArray(dietary_restrictions)) {
        // Si hay restricciones dietéticas, usar la primera (la base de datos solo acepta una)
        if (dietary_restrictions.length > 0 && dietary_restrictions[0] !== '') {
          dietary_restrictions = dietary_restrictions[0];
          
          // Mapear valores en inglés a los valores del ENUM
          if (dietary_restrictions === 'vegetarian') {
            dietary_restrictions = 'vegetariano';
          } else if (dietary_restrictions === 'vegan') {
            dietary_restrictions = 'vegano';
          } else if (dietary_restrictions === 'gluten_free') {
            dietary_restrictions = 'libre de gluten';
          } else if (dietary_restrictions === 'lactose_free') {
            dietary_restrictions = 'libre de lactosa';
          } else if (dietary_restrictions === 'nut_free') {
            dietary_restrictions = 'libre de frutos secos';
          } else if (dietary_restrictions === 'none') {
            dietary_restrictions = 'no';
          } else {
            // Si no coincide con ninguno de los valores esperados
            dietary_restrictions = 'no';
          }
        } else {
          dietary_restrictions = 'no'; // Valor por defecto
        }
      } else if (dietary_restrictions === undefined || dietary_restrictions === null || dietary_restrictions === '') {
        dietary_restrictions = 'no';
      } else {
        // Si es un string pero no es uno de los valores válidos
        if (!['vegetariano', 'vegano', 'libre de gluten', 'libre de lactosa', 'libre de frutos secos', 'no'].includes(dietary_restrictions)) {
          dietary_restrictions = 'no';
        }
      }
      
      console.log('Valor final de dietary_restrictions:', dietary_restrictions);
      
      if (existingProfile && existingProfile.length > 0) {
        // Actualizar perfil existente
        await this.pool.query(
          `UPDATE user_profiles SET 
           age = ?, 
           weight = ?, 
           height = ?, 
           gender = ?, 
           activity_level = ?, 
           training_frequency = ?, 
           primary_goal = ?, 
           sweat_level = ?, 
           caffeine_tolerance = ?, 
           dietary_restrictions = ? 
           WHERE user_id = ?`,
          [
            age, 
            weight, 
            height, 
            gender, 
            activity_level, 
            training_frequency, 
            primary_goal, 
            sweat_level, 
            caffeine_tolerance, 
            dietary_restrictions, 
            userId
          ]
        );
      } else {
        // Crear nuevo perfil
        await this.pool.query(
          `INSERT INTO user_profiles (
            user_id, 
            age, 
            weight, 
            height, 
            gender, 
            activity_level, 
            training_frequency, 
            primary_goal, 
            sweat_level, 
            caffeine_tolerance, 
            dietary_restrictions
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, 
            age, 
            weight, 
            height, 
            gender, 
            activity_level, 
            training_frequency, 
            primary_goal, 
            sweat_level, 
            caffeine_tolerance, 
            dietary_restrictions
          ]
        );
      }
      
      return true;
    } catch (error) {
      console.error('Error en createUserProfile:', error);
      throw error;
    }
  }

  static async getUserById(userId) {
    try {
      const [rows] = await pool.query(
        'SELECT user_id, username, email, created_at FROM users WHERE user_id = ?',
        [userId]
      );
      return rows[0];
    } catch (error) {
      console.error('Error in getUserById:', error);
      throw error;
    }
  }

  static async getUserProfile(userId) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM user_profiles WHERE user_id = ?',
        [userId]
      );
      return rows[0];
    } catch (error) {
      console.error('Error in getUserProfile:', error);
      throw error;
    }
  }
}

export default User;