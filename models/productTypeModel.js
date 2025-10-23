import { BaseModel } from './BaseModel.js';

class ProductType extends BaseModel {
  static tableName = 'product_types';

  static async findByCategory(categoryId) {
    const [rows] = await pool.query(
      'SELECT * FROM product_types WHERE category_id = ?',
      [categoryId]
    );
    return rows;
  }

  static async getFullHierarchy() {
    const [types] = await pool.query(`
      SELECT pt.*, pc.name as category_name
      FROM product_types pt
      JOIN product_categories pc ON pt.category_id = pc.id
    `);
    return types;
  }
}

export default ProductType;