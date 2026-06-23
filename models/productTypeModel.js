import { BaseModel } from './BaseModel.js';
import pool from '../config/db.js';

class ProductType extends BaseModel {
  static tableName = 'product_types';

  static async findByCategory(categoryId) {
    const [rows] = await pool.query(
      'SELECT * FROM product_types WHERE category_id = ?',
      [categoryId]
    );
    return rows;
  }
}

export default ProductType;