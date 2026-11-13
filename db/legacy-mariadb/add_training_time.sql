-- Agregar campo de hora de inicio a training_sessions
ALTER TABLE training_sessions 
ADD COLUMN start_time TIME DEFAULT NULL AFTER session_date;

