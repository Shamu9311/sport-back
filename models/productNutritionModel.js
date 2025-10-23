import { BaseModel } from './BaseModel.js';

class ProductNutrition extends BaseModel {
  static tableName = 'product_nutrition';

  static async getByProduct(productId) {
    const [nutrition] = await this.pool.query(
      'SELECT * FROM product_nutrition WHERE product_id = ?',
      [productId]
    );
    return nutrition[0] || null;
  }

  static async updateOrCreate(productId, data) {
    const existing = await this.getByProduct(productId);
    if (existing) {
      const [result] = await this.pool.query(
        `UPDATE ${this.tableName} SET 
          calories = ?, protein = ?, carbs = ?, fat = ?
          WHERE product_id = ?`,
        [data.calories, data.protein, data.carbs, data.fat, productId]
      );
      return result.affectedRows > 0;
    } else {
      const [result] = await this.pool.query(
        `INSERT INTO ${this.tableName} 
          (product_id, calories, protein, carbs, fat)
          VALUES (?, ?, ?, ?, ?)`,
        [productId, data.calories, data.protein, data.carbs, data.fat]
      );
      return result.insertId;
    }
  }
}

export default ProductNutrition;