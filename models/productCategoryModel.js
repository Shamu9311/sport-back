import { BaseModel } from './BaseModel.js';
import pool from '../config/db.js';

class ProductCategory extends BaseModel {
  static tableName = 'product_categories';
  static primaryKey = 'category_id';

  static async findWithProducts() {
    const [categories] = await pool.query(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM products p
         INNER JOIN product_types pt ON p.type_id = pt.type_id
         WHERE pt.category_id = c.category_id) as product_count
      FROM ${this.tableName} c
    `);
    return categories;
  }

  static async createWithImage({ name, description }) {
    const [result] = await pool.query(
      'INSERT INTO product_categories (name, description) VALUES (?, ?)',
      [name, description]
    );
    return this.findById(result.insertId);
  }
}

export default ProductCategory;