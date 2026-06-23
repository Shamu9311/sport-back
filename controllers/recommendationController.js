// controllers/recommendationController.js
import pool from '../config/db.js';
import { getCandidateProducts } from '../services/retrievalService.js';
import { generateRecommendations } from '../services/llmService.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';
import Feedback from '../models/feedbackModel.js';

export const getRecommendations = async (req, res) => {
    const userId = req.user.id; // Asumiendo que tu middleware authMiddleware añade `req.user = { id: userId, ... }`

    try {
        // 1. Obtener perfil de usuario
        const [profileRows] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
        if (profileRows.length === 0) {
            return sendError(res, 404, 'Completa tu perfil antes de obtener recomendaciones.');
        }
        const userProfile = profileRows[0];

        // 2. Paso de Recuperación (Retriever) - Ahora con soporte de vector search
        const trainingData = req.body.trainingData || {};
        const enrichedProfile = {
            ...userProfile,
            training_type: trainingData.type || userProfile.training_type,
            sport_type: trainingData.sport_type || userProfile.sport_type,
            intensity: trainingData.intensity || userProfile.intensity,
            duration: trainingData.durationMin || trainingData.duration || userProfile.duration,
        };
        const candidateProducts = await getCandidateProducts(enrichedProfile, trainingData);

        if (!candidateProducts || candidateProducts.length === 0) {
             return sendSuccess(res, 200, {
                message: 'No se encontraron productos adecuados según tu perfil. Puedes ajustar tu perfil e intentar de nuevo.',
                data: { recommendations: [] }
            });
        }

        // 3. Paso de Aumentación y Generación (LLM)
        const llmResult = await generateRecommendations(enrichedProfile, candidateProducts, 4);

        const { recommendations: llmRecommendations, llmReasoning, promptUsed } = llmResult;

        if (!llmRecommendations || llmRecommendations.length === 0) {
            return sendSuccess(res, 200, {
                message: llmReasoning || 'El asistente de IA no encontró recomendaciones específicas. Puedes ajustar tu perfil e intentar de nuevo.',
                data: { recommendations: [] }
            });
        }

        // 4. Obtener detalles completos de los product_ids recomendados
        const recommendedProductIds = llmRecommendations.map(rec => rec.product_id).filter(id => typeof id === 'number');

        let finalRecommendedProducts = [];
        if (recommendedProductIds.length > 0) {
            // Reutilizamos la query de candidateProducts pero solo para los IDs recomendados
            // (o una query más simple si ya tienes los datos que necesitas del retriever,
            //  pero el LLM podría necesitar menos datos que los que quieres mostrar al final)
            const placeholders = recommendedProductIds.map(() => '?').join(',');
            const productDetailsQuery = `
                SELECT
                    p.product_id, p.name AS product_name, p.description AS product_description, p.image_url, p.usage_recommendation,
                    pt.name AS type_name, pc.name AS category_name, pc.usage_context,
                    GROUP_CONCAT(DISTINCT pa.name) AS attributes,
                    GROUP_CONCAT(DISTINCT f.name) AS flavors,
                    MAX(pn.serving_size) AS serving_size, MAX(pn.energy_kcal) AS energy_kcal, MAX(pn.protein_g) AS protein_g, 
                    MAX(pn.carbs_g) AS carbs_g, MAX(pn.sugars_g) AS sugars_g, MAX(pn.sodium_mg) AS sodium_mg, 
                    MAX(pn.caffeine_mg) AS caffeine_mg, MAX(pn.other_components) AS other_components
                FROM products p
                LEFT JOIN product_types pt ON p.type_id = pt.type_id
                LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
                LEFT JOIN product_attributes_mapping pam ON p.product_id = pam.product_id
                LEFT JOIN product_attributes pa ON pam.attribute_id = pa.attribute_id
                LEFT JOIN product_flavors pf ON p.product_id = pf.product_id
                LEFT JOIN flavors f ON pf.flavor_id = f.flavor_id
                LEFT JOIN product_nutrition pn ON p.product_id = pn.product_id
                WHERE p.product_id IN (${placeholders}) AND p.is_active = 1
                GROUP BY p.product_id, p.name, p.description, p.image_url, p.usage_recommendation, pt.name, pc.name, pc.usage_context
            `;
            const [detailedProductRows] = await pool.query(productDetailsQuery, recommendedProductIds);

            // Mapear los detalles con el 'reasoning' del LLM
            finalRecommendedProducts = detailedProductRows.map(product => {
                const llmRec = llmRecommendations.find(rec => rec.product_id === product.product_id);
                return {
                    ...product, // Todos los detalles del producto
                    reasoning: llmRec ? llmRec.reasoning : "Reasoning not provided by LLM." // Incluir el razonamiento
                };
            });
        }
        
        // 5. Guardar en la tabla `recommendations` (asíncrono, no bloquear la respuesta al usuario)
        if (finalRecommendedProducts.length > 0) {
            const recommendationInserts = finalRecommendedProducts.map(rec => {
                try {
                    // Función para truncar texto a un tamaño máximo
                    const truncateText = (text, maxLength) => {
                        if (!text) return '';
                        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
                    };
                    
                    // feedback es ENUM (positivo/neutral/negativo) — solo lo llena el usuario
                    // feedback_notes almacena el razonamiento del LLM
                    const productReasoning = truncateText(rec.reasoning || 'Sin razonamiento disponible', 500);
                    const generalReasoning = llmReasoning
                        ? truncateText(llmReasoning, 500)
                        : '';
                    const feedbackNotesText = generalReasoning
                        ? `${productReasoning} | ${generalReasoning}`
                        : productReasoning;

                    return pool.query(
                        'INSERT INTO recommendations (user_id, session_id, product_id, recommended_at, feedback, feedback_notes) VALUES (?, NULL, ?, NOW(), NULL, ?)',
                        [userId, rec.product_id, feedbackNotesText]
                    );
                } catch (error) {
                    console.error(`Error al insertar recomendación para producto ${rec.product_id}:`, error);
                }
            });
            Promise.all(recommendationInserts)
                .then(() => console.log("Recommendations saved to DB for user:", userId))
                .catch(err => console.error("Error saving recommendations to DB:", err));
        }


        // 6. Devolver los productos detallados y su razonamiento
        return sendSuccess(res, 200, {
            message: llmReasoning || 'Recomendaciones generadas correctamente.',
            data: { recommendations: finalRecommendedProducts }
        });

    } catch (error) {
        console.error("Error in getRecommendations controller:", error);
        // Distinguir errores
        if (error.message.includes("User profile not found") || error.message.includes("No candidate products")) {
            return sendError(res, 404, error.message);
        }
        if (
            error.message.includes("LLM") ||
            error.message.includes("OpenAI") ||
            error.message.includes("Gemini")
        ) {
            return sendError(res, 503, 'El servicio de IA no está disponible en este momento. Intenta más tarde.');
        }
        return sendError(res, 500, 'Error al generar recomendaciones.', error);
    }
};

export const postRecommendationFeedback = async (req, res) => {
    const userId = req.user.id;
    const { recommendation_id, product_id, feedback, feedback_notes } = req.body; // feedback_notes será la justificación/feedback del usuario

    if (!product_id || !feedback) {
        return sendError(res, 400, 'product_id y feedback son obligatorios.');
    }

    const validFeedback = ['positivo', 'neutral', 'negativo'];
    if (!validFeedback.includes(feedback)) {
        return sendError(res, 400, 'feedback debe ser positivo, neutral o negativo.');
    }

    try {
        if (recommendation_id) {
            const [result] = await pool.query(
                'UPDATE recommendations SET feedback = ?, feedback_notes = ? WHERE recommendation_id = ? AND user_id = ?',
                [feedback, feedback_notes || null, recommendation_id, userId]
            );
            if (result.affectedRows === 0) {
                return sendError(res, 404, 'Recomendación no encontrada o no autorizada.');
            }
        } else {
            // Fallback si no hay recommendation_id, intentamos actualizar el más reciente para el producto y usuario.
            // Esto es menos preciso. Es mejor tener IDs.
            const [result] = await pool.query(
                `UPDATE recommendations SET feedback = ?, feedback_notes = ? 
                 WHERE user_id = ? AND product_id = ? 
                 ORDER BY recommended_at DESC LIMIT 1`,
                [feedback, feedback_notes || null, userId, product_id]
            );
             if (result.affectedRows === 0) {
                // Si no se encontró para actualizar, quizás se debería insertar una entrada de feedback aislada o un log.
                // O simplemente devolver que no se encontró para actualizar.
                console.warn(`No recommendation found to update feedback for user ${userId}, product ${product_id}`);
                return sendError(res, 404, 'No hay recomendación previa para actualizar el feedback de este producto.');
            }
        }


        return sendSuccess(res, 200, { message: 'Feedback enviado correctamente.' });
    } catch (error) {
        console.error("Error submitting recommendation feedback:", error);
        return sendError(res, 500, 'No se pudo enviar el feedback.', error);
    }
};

// Obtener recomendaciones guardadas para un usuario (JWT)
export const getSavedRecommendations = async (req, res) => {
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    try {
        // Obtener las recomendaciones guardadas con detalles del producto
        const [recommendations] = await pool.query(`
            SELECT r.*, p.name as product_name, p.description as product_description, p.image_url,
                   pt.name as type_name, pc.name as category_name
            FROM recommendations r
            JOIN products p ON r.product_id = p.product_id
            LEFT JOIN product_types pt ON p.type_id = pt.type_id
            LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
            WHERE r.user_id = ?
            ORDER BY r.recommended_at DESC
            LIMIT ? OFFSET ?
        `, [userId, limit, offset]);

        if (recommendations.length === 0) {
            return sendSuccess(res, 200, {
                message: 'No se encontraron recomendaciones para este usuario.',
                data: { recommendations: [] }
            });
        }

        return sendSuccess(res, 200, {
            message: 'Recomendaciones obtenidas correctamente.',
            data: { recommendations }
        });
    } catch (error) {
        console.error("Error getting saved recommendations:", error);
        return sendError(res, 500, 'Error al obtener recomendaciones guardadas.', error);
    }
};

export const postProductFeedback = async (req, res) => {
    try {
        const { userId, productId, feedback, notes } = req.body;

        if (!userId || !productId || !feedback) {
            return sendError(res, 400, 'userId, productId y feedback son requeridos');
        }
        if (parseInt(userId, 10) !== req.user.id) {
            return sendError(res, 403, 'Acceso denegado');
        }

        if (!['positivo', 'negativo'].includes(feedback)) {
            return sendError(res, 400, 'Feedback debe ser "positivo" o "negativo"');
        }

        const result = await Feedback.saveFeedback({
            userId,
            productId,
            feedback,
            notes
        });

        return sendSuccess(res, 200, { data: result, message: 'Feedback guardado correctamente.' });
    } catch (error) {
        console.error('Error en product-feedback:', error);
        return sendError(res, 500, 'Error al guardar el feedback', error);
    }
};

export const getUserFeedback = async (req, res) => {
    try {
        const userId = req.user.id;
        const history = await Feedback.getUserFeedbackHistory(userId);

        return sendSuccess(res, 200, {
            message: 'Historial de feedback obtenido correctamente.',
            data: { feedback: history }
        });
    } catch (error) {
        console.error('Error getting user feedback:', error);
        return sendError(res, 500, 'Error al obtener feedback', error);
    }
};