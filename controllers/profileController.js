import User from '../models/userModel.js';
import { createConnection } from '../config/db.js';
import { getCandidateProducts } from '../services/retrievalService.js';
import { generateRecommendations } from '../services/llmService.js';

const db = createConnection();

// Función auxiliar para generar recomendaciones iniciales
async function generateInitialRecommendations(userId) {
    try {
        console.log(`Generando recomendaciones iniciales para usuario ${userId}...`);
        
        // 1. Obtener perfil de usuario
        const [profileRows] = await db.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
        if (profileRows.length === 0) {
            console.log(`No se encontró perfil para usuario ${userId}`);
            return;
        }
        const userProfile = profileRows[0];

        // 2. Obtener productos candidatos
        const trainingData = {}; // Sin datos de entrenamiento para recomendaciones iniciales
        const candidateProducts = await getCandidateProducts(userProfile, trainingData);

        if (!candidateProducts || candidateProducts.length === 0) {
            console.log(`No se encontraron productos candidatos para usuario ${userId}`);
            return;
        }

        // 3. Generar recomendaciones con LLM
        const llmResult = await generateRecommendations(userProfile, candidateProducts, 3);
        const { recommendations: llmRecommendations, llmReasoning } = llmResult;

        if (!llmRecommendations || llmRecommendations.length === 0) {
            console.log(`No se generaron recomendaciones del LLM para usuario ${userId}`);
            return;
        }

        // 4. Guardar recomendaciones en la base de datos
        const recommendedProductIds = llmRecommendations.map(rec => rec.product_id).filter(id => typeof id === 'number');
        
        if (recommendedProductIds.length > 0) {
            const placeholders = recommendedProductIds.map(() => '?').join(',');
            const [products] = await db.query(`
                SELECT p.product_id, p.name, p.description, p.image_url
                FROM products p
                WHERE p.product_id IN (${placeholders}) AND p.is_active = 1
            `, recommendedProductIds);

            // Guardar en la tabla recommendations
            const recommendationInserts = products.map(product => {
                const llmRec = llmRecommendations.find(rec => rec.product_id === product.product_id);
                const feedbackText = llmRec?.reasoning ? llmRec.reasoning.substring(0, 250) : 'Recomendación inicial basada en tu perfil';
                const feedbackNotesText = (llmReasoning || 'Recomendación generada automáticamente').substring(0, 255);
                
                return db.query(
                    'INSERT INTO recommendations (user_id, session_id, product_id, recommended_at, feedback, feedback_notes) VALUES (?, NULL, ?, NOW(), ?, ?)',
                    [userId, product.product_id, feedbackText, feedbackNotesText]
                );
            });

            await Promise.all(recommendationInserts);
            console.log(`✅ Recomendaciones iniciales generadas y guardadas para usuario ${userId}: ${products.length} productos`);
        }
    } catch (error) {
        console.error(`Error generando recomendaciones iniciales para usuario ${userId}:`, error.message);
    }
}

export const saveProfile = async (req, res) => {
    try {
        const userIdFromParams = req.params.userId;
        const profileData = req.body;

        // Validación del ID de usuario
        const userId = parseInt(userIdFromParams, 10);
        if (isNaN(userId) || userId <= 0) {
            console.error('[ProfileController] ID de usuario inválido:', userIdFromParams);
            return res.status(400).json({
                success: false,
                message: 'ID de usuario inválido o faltante'
            });
        }

        // Validación de datos del perfil
        if (!profileData.age || !profileData.weight || !profileData.height) {
            return res.status(400).json({
                success: false,
                message: 'Edad, peso y altura son campos obligatorios'
            });
        }

        // Validación adicional de rangos
        if (profileData.age < 12 || profileData.age > 120) {
            return res.status(400).json({
                success: false,
                message: 'La edad debe estar entre 12 y 120 años'
            });
        }

        // Guardar el perfil
        await User.createUserProfile(userId, profileData);

        // Generar recomendaciones iniciales automáticamente (asíncrono, no bloquea la respuesta)
        generateInitialRecommendations(userId).catch(err => {
            console.error(`Error en background generando recomendaciones para usuario ${userId}:`, err);
        });

        res.status(200).json({
            success: true,
            message: 'Perfil guardado exitosamente',
            data: {
                userId,
                ...profileData
            }
        });

    } catch (error) {
        console.error('[ProfileController] Error al guardar perfil:', error);
        
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(404).json({
                success: false,
                message: 'El usuario asociado no existe'
            });
        }

        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'development' 
                   ? error.message 
                   : 'Error al guardar el perfil'
        });
    }
};

export const getProfile = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        
        if (isNaN(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'ID de usuario inválido'
            });
        }

        // Obtener datos de usuario y perfil
        const userData = await User.getUserById(userId);
        const profileData = await User.getUserProfile(userId);

        if (!userData) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                user: {
                    username: userData.username,
                    email: userData.email,
                    created_at: userData.created_at
                },
                profile: profileData || null
            }
        });

    } catch (error) {
        console.error(`[ProfileController] Error:`, error);
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'development'
                   ? error.message
                   : 'Error al obtener el perfil'
        });
    }
};

// Opcional: Exportación por defecto si prefieres
export default {
    saveProfile,
    getProfile
};