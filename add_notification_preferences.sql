-- Tabla de preferencias de notificaciones
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT PRIMARY KEY,
  consumption_reminders BOOLEAN DEFAULT TRUE,
  training_alerts BOOLEAN DEFAULT TRUE,
  preferred_time TIME DEFAULT '09:00:00',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insertar preferencias por defecto para usuarios existentes
INSERT IGNORE INTO notification_preferences (user_id, consumption_reminders, training_alerts)
SELECT user_id, TRUE, TRUE FROM users;

