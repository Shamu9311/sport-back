import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/appConfig.js';
import { sendError } from '../utils/apiResponse.js';

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validación básica
    if(!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Todos los campos son requeridos'
      });
    }

    // Validación de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Formato de email inválido'
      });      
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findByEmail(email);
    if(existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'El correo ya está registrado' 
      });
    }

    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'El nombre de usuario ya está en uso'
      });
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear usuario
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword
    });

    res.status(201).json({ 
      success: true, 
      message: 'Usuario registrado exitosamente',
      user: {
        id: newUser.user_id,
        username: newUser.username,
        email: newUser.email,
        created_at: newUser.created_at
      }
    });

  } catch (error) {
    console.error('Error en register:', error);
    return sendError(res, 500, 'Error en el servidor', error);
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 400, 'Email y contraseña son obligatorios');
    }
    
    const user = await User.findByEmail(email);
    
    if(!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales inválidas' 
      });
    }

    // Generar JWT
    const token = jwt.sign(
      {
        id: user.user_id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(200).json({ 
      success: true, 
      message: 'Inicio de sesión exitoso',
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      },
      token
    });

  } catch (error) {
    console.error('Error en login:', error);
    return sendError(res, 500, 'Error en el servidor', error);
  }
};