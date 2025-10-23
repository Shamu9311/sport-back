import { BaseModel } from './BaseModel.js';

class ProductCategory extends BaseModel {
  static tableName = 'product_categories';
  static primaryKey = 'category_id';

  static async findWithProducts() {
    const [categories] = await pool.query(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count
      FROM ${this.tableName} c
    `);
    return categories;
  }

  static async createWithImage({ name, description, imageUrl }) {
    const [result] = await pool.query(
      'INSERT INTO product_categories (name, description, image_url) VALUES (?, ?, ?)',
      [name, description, imageUrl]
    );
    return this.findById(result.insertId);
  }
}

export default ProductCategory;