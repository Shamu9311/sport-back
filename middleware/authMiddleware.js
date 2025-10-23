// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const authMiddleware = (req, res, next) => {
    // 1. Obtener el token de la cabecera 'Authorization'
    // El formato común es 'Bearer TOKEN_AQUI'
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token.' });
    }

    // 2. Verificar que el token tenga el formato 'Bearer <token>'
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ message: 'Acceso denegado. Formato de token inválido. Debe ser "Bearer <token>".' });
    }

    const token = parts[1];

    if (!token) { // Doble chequeo por si parts[1] fuera undefined aunque parts.length sea 2
        return res.status(401).json({ message: 'Acceso denegado. No se proporcionó token.' });
    }

    try {
        // 3. Verificar el token usando tu JWT_SECRET
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 4. Añadir la información decodificada del usuario (payload del token) al objeto `req`
        req.user = decoded; // 'decoded' contendrá lo que hayas puesto en el payload al crear el token (ej. { id: userId, username: '...' })

        // 5. Llamar a next() para pasar el control al siguiente middleware o al controlador de la ruta
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expirado.' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Token inválido.' });
        }
        console.error("Error en authMiddleware:", error);
        return res.status(401).json({ message: 'Token no válido o error de autenticación.' });
    }
};

export default authMiddleware;