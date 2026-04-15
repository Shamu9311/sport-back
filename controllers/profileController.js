import User from '../models/userModel.js';
import { sendError } from '../utils/apiResponse.js';

export const saveProfile = async (req, res) => {
    try {
        const userIdFromParams = req.params.userId;
        const profileData = req.body;

        // Validación del ID de usuario
        const userId = parseInt(userIdFromParams, 10);
        if (isNaN(userId) || userId <= 0) {
            console.error('[ProfileController] ID de usuario inválido:', userIdFromParams);
            return sendError(res, 400, 'ID de usuario inválido o faltante');
        }

        // Validación de datos del perfil
        if (!profileData.age || !profileData.weight || !profileData.height) {
            return sendError(res, 400, 'Edad, peso y altura son campos obligatorios');
        }

        // Validación adicional de rangos
        if (profileData.age < 12 || profileData.age > 120) {
            return sendError(res, 400, 'La edad debe estar entre 12 y 120 años');
        }

        // Guardar el perfil
        await User.createUserProfile(userId, profileData);

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
            return sendError(res, 404, 'El usuario asociado no existe');
        }

        return sendError(
            res,
            500,
            process.env.NODE_ENV === 'development' ? error.message : 'Error al guardar el perfil',
            error
        );
    }
};

export const getProfile = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        
        if (isNaN(userId) || userId <= 0) {
            return sendError(res, 400, 'ID de usuario inválido');
        }

        // Obtener datos de usuario y perfil
        const userData = await User.getUserById(userId);
        const profileData = await User.getUserProfile(userId);

        if (!userData) {
            return sendError(res, 404, 'Usuario no encontrado');
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
        return sendError(
            res,
            500,
            process.env.NODE_ENV === 'development' ? error.message : 'Error al obtener el perfil',
            error
        );
    }
};

// Opcional: Exportación por defecto si prefieres
export default {
    saveProfile,
    getProfile
};