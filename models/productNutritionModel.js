import { BaseModel } from './BaseModel.js';

class ProductNutrition extends BaseModel {
  static tableName = 'product_nutrition';
  static primaryKey = 'nutrition_id';

  static async getByProduct(productId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM product_nutrition WHERE product_id = $1 ORDER BY nutrition_id',
      [productId]
    );
    return rows[0] || null;
  }

  static async updateOrCreate(productId, data) {
    const existing = await this.getByProduct(productId);
    if (existing) {
      const result = await this.pool.query(
        `UPDATE ${this.tableName} SET 
          energy_kcal = $1, protein_g = $2, carbs_g = $3, sugars_g = $4
          WHERE product_id = $5`,
        [data.energy_kcal, data.protein_g, data.carbs_g, data.sugars_g, productId]
      );
      return result.rowCount > 0;
    } else {
      const { rows } = await this.pool.query(
        `INSERT INTO ${this.tableName} 
          (product_id, energy_kcal, protein_g, carbs_g, sugars_g)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING nutrition_id`,
        [productId, data.energy_kcal, data.protein_g, data.carbs_g, data.sugars_g]
      );
      return rows[0].nutrition_id;
    }
  }
}

export default ProductNutrition;
