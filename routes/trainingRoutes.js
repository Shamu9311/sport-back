import express from 'express';
import TrainingSession from '../models/trainingSessionModel.js';
import TrainingRecommendationService from '../services/trainingRecommendationService.js';

const router = express.Router();

// Get all training sessions for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await TrainingSession.findByUserId(userId);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching training sessions:', error);
    res.status(500).json({ message: 'Error fetching training sessions' });
  }
});

// Get a specific training session
router.get('/:id', async (req, res) => {
  try {
    const session = await TrainingSession.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ message: 'Training session not found' });
    }
    
    res.json(session);
  } catch (error) {
    console.error('Error fetching training session:', error);
    res.status(500).json({ message: 'Error fetching training session' });
  }
});

// Create a new training session
router.post('/', async (req, res) => {
  try {
    const { userId, session_date, duration_min, intensity, type, weather, notes } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
    // Crear la sesión de entrenamiento
    const session = await TrainingSession.createSession({
      userId,
      sessionDate: session_date,
      durationMin: duration_min,
      intensity,
      type,
      weather,
      notes
    });

    // Generar recomendaciones en segundo plano (no esperar a que terminen)
    try {
      const trainingData = {
        type,
        intensity,
        durationMin: duration_min,
        weather,
        notes
      };
      
      TrainingRecommendationService.generateTrainingRecommendations(
        userId, 
        session.session_id, 
        trainingData
      )
      .then(() => console.log('Recomendaciones generadas exitosamente'))
      .catch(err => console.error('Error generando recomendaciones:', err));
      
    } catch (recError) {
      console.error('Error en generación de recomendaciones:', recError);
      // No fallar la petición si hay error en recomendaciones
    }
    
    res.status(201).json(session);
  } catch (error) {
    console.error('Error creating training session:', error);
    res.status(500).json({ message: 'Error creating training session' });
  }
});

// Get recommendations for a training session
router.get('/:id/recommendations', async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
    const recommendations = await TrainingRecommendationService.getTrainingSessionRecommendations(
      userId,
      sessionId
    );
    
    res.json(recommendations);
  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ message: 'Error getting recommendations' });
  }
});

// Update a training session
router.put('/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const existingSession = await TrainingSession.findById(sessionId);
    
    if (!existingSession) {
      return res.status(404).json({ message: 'Training session not found' });
    }
    
    const { sessionDate, durationMin, intensity, type, weather, notes } = req.body;
    
    const updatedSession = await TrainingSession.updateSession(sessionId, {
      sessionDate,
      durationMin,
      intensity,
      type,
      weather,
      notes
    });
    
    res.json(updatedSession);
  } catch (error) {
    console.error('Error updating training session:', error);
    res.status(500).json({ message: 'Error updating training session' });
  }
});

// Delete a training session
router.delete('/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const existingSession = await TrainingSession.findById(sessionId);
    
    if (!existingSession) {
      return res.status(404).json({ message: 'Training session not found' });
    }
    
    await TrainingSession.deleteSession(sessionId);
    
    res.json({ message: 'Training session deleted successfully' });
  } catch (error) {
    console.error('Error deleting training session:', error);
    res.status(500).json({ message: 'Error deleting training session' });
  }
});

export default router;
