import Recommendation from '../models/recommendationModel.js';
import User from '../models/userModel.js';
import { getRecommendationsFromLLM } from './llmService.js';

export default class TrainingRecommendationService {
  static async generateTrainingRecommendations(userId, sessionId, trainingData) {
    try {
      console.log(`Generando recomendaciones para usuario ${userId}, sesión ${sessionId}`);
      
      // 1. Obtener el perfil del usuario
      const [userProfile] = await User.pool.query(
        `SELECT up.*, u.email, u.username 
         FROM user_profiles up
         JOIN users u ON up.user_id = u.user_id
         WHERE up.user_id = ?`,
        [userId]
      );

      if (!userProfile || userProfile.length === 0) {
        console.warn('No se encontró el perfil del usuario');
        // Usar valores por defecto si no hay perfil
        const defaultProfile = {
          age: 30,
          weight: 70,
          height: 170,
          gender: 'otro',
          activity_level: 'moderado',
          training_frequency: '3-4',
          primary_goal: 'mejor rendimiento',
          sweat_level: 'medio',
          caffeine_tolerance: 'medio',
          dietary_restrictions: 'Ninguna'
        };
        console.log('Usando perfil por defecto:', defaultProfile);
        userProfile[0] = defaultProfile;
      }

      // 2. Obtener productos candidatos usando retrieval service (con soporte RAG)
      const { getCandidateProducts } = await import('./retrievalService.js');
      
      // Combinar perfil con datos de entrenamiento
      const combinedProfile = {
        ...userProfile[0],
        training_type: trainingData.type,
        intensity: trainingData.intensity,
        duration: trainingData.durationMin
      };
      
      let products = await getCandidateProducts(combinedProfile, trainingData);
      
      // Fallback si no se encuentran productos con el nuevo sistema
      if (!products || products.length === 0) {
        console.warn('No se encontraron productos candidatos con retrieval, usando método alternativo');
        products = await Recommendation.getRecommendedProducts(userId, trainingData);
      }
      
      if (!products || products.length === 0) {
        console.warn('No hay productos disponibles para recomendar');
        return [];
      }

      console.log(`Productos candidatos para recomendación:`, products.map(p => p.name).join(', '));

      // 3. Preparar los datos para el LLM
      const profileData = {
        user_id: userId,
        age: userProfile[0].age || 30,
        weight: userProfile[0].weight || 70,
        height: userProfile[0].height || 170,
        gender: userProfile[0].gender || 'otro',
        activity_level: userProfile[0].activity_level || 'moderado',
        training_frequency: userProfile[0].training_frequency || '3-4',
        primary_goal: userProfile[0].primary_goal || 'mejor rendimiento',
        sweat_level: userProfile[0].sweat_level || 'medio',
        caffeine_tolerance: userProfile[0].caffeine_tolerance || 'medio',
        dietary_restrictions: userProfile[0].dietary_restrictions || 'Ninguna',
        training_type: trainingData.type,
        intensity: trainingData.intensity,
        duration: trainingData.durationMin,
        weather: trainingData.weather,
        notes: trainingData.notes || ''
      };

      console.log('Datos del perfil para el LLM:', JSON.stringify(profileData, null, 2));

      // 4. Obtener recomendaciones usando el LLM
      const llmResponse = await getRecommendationsFromLLM(
        profileData,
        products,
        3 // Número de recomendaciones
      );

      console.log('Respuesta del LLM:', JSON.stringify(llmResponse, null, 2));

      // 5. Procesar las recomendaciones
      const recommendations = [];
      
      if (llmResponse && llmResponse.recommendations && llmResponse.recommendations.length > 0) {
        for (const rec of llmResponse.recommendations) {
          const product = products.find(p => p.product_id === rec.product_id);
          if (product) {
            try {
              const recommendation = await Recommendation.createRecommendation({
                userId,
                sessionId,
                productId: product.product_id,
                reason: rec.reasoning || 'Recomendación basada en tu entrenamiento',
                score: rec.score || Math.floor(Math.random() * 50) + 50,
                consumption_timing: rec.consumption_timing || null,
                consumption_instructions: rec.instructions || null,
                recommended_quantity: rec.quantity || null,
                timing_minutes: rec.timing_minutes || null
              });
              
              if (recommendation) {
                recommendations.push(recommendation);
                console.log(`Recomendación creada para producto ${product.name} - Timing: ${rec.consumption_timing || 'No especificado'}`);
              }
            } catch (error) {
              console.error(`Error creando recomendación para producto ${product.product_id}:`, error);
            }
          }
        }
      }

      console.log(`Se generaron ${recommendations.length} recomendaciones exitosamente`);
      return recommendations;
      
    } catch (error) {
      console.error('Error en generateTrainingRecommendations:', error);
      // En caso de error, devolver un array vacío para no interrumpir el flujo
      return [];
    }
  }

  // Obtener recomendaciones para una sesión de entrenamiento
  static async getTrainingSessionRecommendations(userId, sessionId) {
    try {
      return await Recommendation.getByTrainingSession(userId, sessionId);
    } catch (error) {
      console.error('Error obteniendo recomendaciones de la sesión:', error);
      throw error;
    }
  }

  // Actualizar feedback de una recomendación
  static async updateRecommendationFeedback(recommendationId, feedback, notes = null) {
    try {
      return await Recommendation.updateFeedback(recommendationId, feedback, notes);
    } catch (error) {
      console.error('Error actualizando feedback de la recomendación:', error);
      throw error;
    }
  }
}
