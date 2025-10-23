import { BaseModel } from './BaseModel.js';

class UserProfile extends BaseModel {
  static tableName = 'user_profiles';

  static async completeProfile(userId, profileData) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO ${this.tableName} 
          (user_id, bio, avatar_url, height, weight, birth_date)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          bio = VALUES(bio),
          avatar_url = VALUES(avatar_url),
          height = VALUES(height),
          weight = VALUES(weight),
          birth_date = VALUES(birth_date)`,
        [
          userId,
          profileData.bio,
          profileData.avatarUrl,
          profileData.height,
          profileData.weight,
          profileData.birthDate
        ]
      );

      await connection.query(
        'UPDATE users SET profile_completed = TRUE WHERE id = ?',
        [userId]
      );

      await connection.commit();
      return this.findByUserId(userId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async findByUserId(userId) {
    const [rows] = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = ?',
      [userId]
    );
    return rows[0] || null;
  }
}

export default UserProfile;