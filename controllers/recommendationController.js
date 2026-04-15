// controllers/recommendationController.js
import pool from '../config/db.js';
import { getCandidateProducts } from '../services/retrievalService.js';
import { generateRecommendations } from '../services/llmService.js';
import { sendError } from '../utils/apiResponse.js';

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
        const candidateProducts = await getCandidateProducts(userProfile, trainingData);

        if (!candidateProducts || candidateProducts.length === 0) {
             return res.status(200).json({ // Podría ser 200 con un mensaje o 404 si lo consideras 'no encontrado'
                message: "No suitable products found based on your current profile and our catalog filters. You can try adjusting your profile.",
                recommendations: []
            });
        }

        // 3. Paso de Aumentación y Generación (LLM)
        const llmResult = await generateRecommendations(userProfile, candidateProducts, 3); // Pedimos 3 recomendaciones

        const { recommendations: llmRecommendations, llmReasoning, promptUsed } = llmResult;

        if (!llmRecommendations || llmRecommendations.length === 0) {
            return res.status(200).json({
                message: llmReasoning || "The AI assistant couldn't find specific recommendations from the candidates based on your profile. You can try adjusting your profile.",
                recommendations: []
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
                    
                    // Usar las columnas correctas que existen en la tabla
                    // Usando session_id como NULL ya que no está disponible en este contexto
                    // Usando feedback para almacenar el razonamiento específico del producto (máx 250 caracteres)
                    // Usando feedback_notes para almacenar el razonamiento general del LLM (máx 255 caracteres)
                    const feedbackText = truncateText(rec.reasoning || "Sin razonamiento disponible", 250);
                    const feedbackNotesText = truncateText(llmReasoning || "Recomendación generada basada en tu perfil", 255);
                    
                    return pool.query(
                        'INSERT INTO recommendations (user_id, session_id, product_id, recommended_at, feedback, feedback_notes) VALUES (?, NULL, ?, NOW(), ?, ?)',
                        [
                            userId,
                            rec.product_id,
                            feedbackText,
                            feedbackNotesText
                        ]
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
        res.json({
            message: llmReasoning || "Recommendations generated successfully.",
            recommendations: finalRecommendedProducts
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
                `UPDATE recommendations SET feedback = ?, feedback_notes_user = ? 
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


        res.status(200).json({ message: "Feedback submitted successfully." });
    } catch (error) {
        console.error("Error submitting recommendation feedback:", error);
        return sendError(res, 500, 'No se pudo enviar el feedback.', error);
    }
};

// Obtener recomendaciones guardadas para un usuario (JWT)
export const getSavedRecommendations = async (req, res) => {
    const userId = req.user.id;

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
            LIMIT 10
        `, [userId]);

        if (recommendations.length === 0) {
            return res.status(200).json({
                message: "No recommendations found for this user",
                recommendations: []
            });
        }

        res.json({
            message: "Recommendations retrieved successfully",
            recommendations: recommendations
        });
    } catch (error) {
        console.error("Error getting saved recommendations:", error);
        return sendError(res, 500, 'Error al obtener recomendaciones guardadas.', error);
    }
};