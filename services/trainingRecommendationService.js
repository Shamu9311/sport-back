import Recommendation from '../models/recommendationModel.js';
import User from '../models/userModel.js';
import { getRecommendationsFromLLM } from './llmService.js';
import { isEvidenceRagEnabled } from './evidenceRetrievalService.js';
import { generateEvidenceRecommendations } from './evidenceRecommendationService.js';
import Feedback from '../models/feedbackModel.js';

/** Estado de generación de la sesión (solo Evidence RAG; el flujo antiguo no lo usa). */
async function setSessionStatus(sessionId, status, note = null) {
  if (!sessionId) return;
  await User.pool.query(
    'UPDATE training_sessions SET recommendation_status = $2, recommendation_note = $3 WHERE session_id = $1',
    [sessionId, status, note ? String(note).slice(0, 1000) : null]
  ).catch((e) => console.error('No se pudo actualizar el estado de recomendaciones:', e.message));
}

export default class TrainingRecommendationService {
  static async generateTrainingRecommendations(userId, sessionId, trainingData) {
    const evidenceMode = isEvidenceRagEnabled();
    try {
      console.log(`Generando recomendaciones para usuario ${userId}, sesión ${sessionId}`);
      if (evidenceMode) await setSessionStatus(sessionId, 'pending');
      
      // 1. Obtener el perfil del usuario
      const { rows: userProfile } = await User.pool.query(
        `SELECT up.*, u.email, u.username 
         FROM user_profiles up
         JOIN users u ON up.user_id = u.user_id
         WHERE up.user_id = $1`,
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
          dietary_restrictions: 'no'
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
        sport_type: trainingData.sport_type,
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
        if (evidenceMode) await setSessionStatus(sessionId, 'none', 'No hay productos candidatos para tu perfil.');
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
        dietary_restrictions: userProfile[0].dietary_restrictions || 'no',
        sport_type: trainingData.sport_type || '10K',
        training_type: trainingData.type,
        training_intensity: trainingData.intensity,
        training_duration_min: trainingData.durationMin,
        training_weather: trainingData.weather,
        training_notes: trainingData.notes || '',
        intensity: trainingData.intensity,
        duration: trainingData.durationMin,
        weather: trainingData.weather,
        notes: trainingData.notes || ''
      };

      console.log('Datos del perfil para el LLM:', JSON.stringify(profileData, null, 2));

      // 4b. Evidence RAG (USE_EVIDENCE_RAG=true): sin cuotas por fase ni relleno; trazable a claims y fuentes
      if (evidenceMode) {
        return await this.generateWithEvidence(userId, sessionId, userProfile[0], trainingData, products);
      }

      // 4. Obtener recomendaciones usando el LLM
      const llmResponse = await getRecommendationsFromLLM(
        profileData,
        products,
        4
      );

      console.log('Respuesta del LLM:', JSON.stringify(llmResponse, null, 2));

      // 5. Procesar las recomendaciones
      const inputs = [];

      if (llmResponse && llmResponse.recommendations && llmResponse.recommendations.length > 0) {
        for (const rec of llmResponse.recommendations) {
          const product = products.find(p => p.product_id === rec.product_id);
          if (product) {
            const instructionsBase = rec.instructions || '';
            const consumptionInstructions = rec.interval_minutes
              ? `[interval_minutes=${rec.interval_minutes}] ${instructionsBase}`.trim()
              : instructionsBase || null;

            inputs.push({
              userId,
              sessionId,
              productId: product.product_id,
              reason: rec.reasoning || 'Recomendación basada en tu entrenamiento',
              score: rec.score || Math.floor(Math.random() * 50) + 50,
              consumption_timing: rec.consumption_timing || null,
              consumption_instructions: consumptionInstructions,
              recommended_quantity: rec.quantity || null,
              timing_minutes: rec.timing_minutes || null
            });
          }
        }
      }

      // Se guardan todas juntas (una transacción) para que el frontend nunca vea una lista parcial
      const recommendations = await Recommendation.createRecommendationsBatch(inputs);
      recommendations.forEach((r) => {
        console.log(`Recomendación creada para producto ${r.product_name} - Timing: ${r.consumption_timing || 'No especificado'}`);
      });

      console.log(`Se generaron ${recommendations.length} recomendaciones exitosamente`);
      return recommendations;
      
    } catch (error) {
      console.error('Error en generateTrainingRecommendations:', error);
      if (evidenceMode) await setSessionStatus(sessionId, 'failed', 'No se pudieron generar las recomendaciones.');
      // En caso de error, devolver un array vacío para no interrumpir el flujo
      return [];
    }
  }

  /** Flujo Evidence RAG: genera, valida y persiste recomendaciones con su evidencia en una transacción. */
  static async generateWithEvidence(userId, sessionId, profile, trainingData, candidates) {
    const positiveProductIds = userId ? await Feedback.getPositiveFeedbackProducts(userId).catch(() => []) : [];
    const result = await generateEvidenceRecommendations({ profile, trainingData, candidates, positiveProductIds });
    const inputs = result.recommendations.map((rec) => ({
      userId,
      sessionId,
      productId: rec.product_id,
      reason: rec.reasoning,
      consumption_timing: rec.consumption_timing,
      consumption_instructions: [rec.interval_minutes ? `[interval_minutes=${rec.interval_minutes}]` : null, rec.instructions]
        .filter(Boolean).join(' ') || null,
      recommended_quantity: rec.quantity,
      timing_minutes: rec.timing_minutes,
      evidence_mode: 'evidence_rag',
      cadence_status: rec.cadence_status,
      evidence_note: rec.evidence_note,
      evidence: rec.evidence,
    }));
    const saved = await Recommendation.createRecommendationsBatch(inputs);
    const note = saved.length
      ? null
      : result.omittedPhases.map((o) => `${o.timing}: ${o.reason}`).join(' | ') || result.llmReasoning;
    await setSessionStatus(sessionId, saved.length ? 'ready' : 'none', note);
    console.log(`Evidence RAG (${result.mode}): ${saved.length} recomendación(es) para la sesión ${sessionId}`);
    return saved;
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
