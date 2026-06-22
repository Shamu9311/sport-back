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
          energy_kcal = ?, protein_g = ?, carbs_g = ?, sugars_g = ?
          WHERE product_id = ?`,
        [data.energy_kcal, data.protein_g, data.carbs_g, data.sugars_g, productId]
      );
      return result.affectedRows > 0;
    } else {
      const [result] = await this.pool.query(
        `INSERT INTO ${this.tableName} 
          (product_id, energy_kcal, protein_g, carbs_g, sugars_g)
          VALUES (?, ?, ?, ?, ?)`,
        [productId, data.energy_kcal, data.protein_g, data.carbs_g, data.sugars_g]
      );
      return result.insertId;
    }
  }
}

export default ProductNutrition;