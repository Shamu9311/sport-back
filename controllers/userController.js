import { User, UserProfile } from '../models/index.js';

class UserController {
  static async getProfile(req, res) {
    try {
      const { userId } = req.params;
      const profile = await UserProfile.findByUserId(userId);
      
      if (!profile) {
        return res.status(404).json({ message: 'Perfil no encontrado' });
      }
      
      res.json(profile);
    } catch (error) {
      res.status(500).json({ 
        message: 'Error al obtener perfil',
        error: error.message 
      });
    }
  }
}

export default UserController;