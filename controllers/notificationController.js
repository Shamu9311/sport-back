import { pool } from '../config/db.js';
import { sendError } from '../utils/apiResponse.js';

class NotificationController {
  /**
   * Obtener preferencias de notificaciones del usuario
   */
  static async getPreferences(req, res) {
    try {
      const { userId } = req.params;

      const [preferences] = await pool.query(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [userId]
      );

      if (preferences.length === 0) {
        // Crear preferencias por defecto si no existen
        await pool.query(
          'INSERT INTO notification_preferences (user_id) VALUES (?)',
          [userId]
        );

        return res.json({
          success: true,
          data: {
            user_id: parseInt(userId),
            consumption_reminders: true,
            training_alerts: true,
            preferred_time: '09:00:00',
          },
        });
      }

      res.json({
        success: true,
        data: preferences[0],
      });
    } catch (error) {
      console.error('Error en NotificationController.getPreferences:', error);
      return sendError(res, 500, 'Error al obtener preferencias de notificaciones', error);
    }
  }

  /**
   * Actualizar preferencias de notificaciones
   */
  static async updatePreferences(req, res) {
    try {
      const { userId } = req.params;
      const { consumption_reminders, training_alerts, preferred_time } = req.body;

      // Verificar si existen preferencias
      const [existing] = await pool.query(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [userId]
      );

      if (existing.length === 0) {
        // Crear nuevas preferencias
        await pool.query(
          `INSERT INTO notification_preferences 
           (user_id, consumption_reminders, training_alerts, preferred_time) 
           VALUES (?, ?, ?, ?)`,
          [userId, consumption_reminders, training_alerts, preferred_time]
        );
      } else {
        // Actualizar preferencias existentes
        await pool.query(
          `UPDATE notification_preferences 
           SET consumption_reminders = ?, 
               training_alerts = ?, 
               preferred_time = ?
           WHERE user_id = ?`,
          [consumption_reminders, training_alerts, preferred_time, userId]
        );
      }

      // Obtener preferencias actualizadas
      const [updated] = await pool.query(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [userId]
      );

      res.json({
        success: true,
        message: 'Preferencias actualizadas correctamente',
        data: updated[0],
      });
    } catch (error) {
      console.error('Error en NotificationController.updatePreferences:', error);
      return sendError(res, 500, 'Error al actualizar preferencias', error);
    }
  }
}

export default NotificationController;

