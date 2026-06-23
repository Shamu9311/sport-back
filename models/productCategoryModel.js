import { BaseModel } from './BaseModel.js';

class ProductCategory extends BaseModel {
  static tableName = 'product_categories';
  static primaryKey = 'category_id';

  static async createWithImage({ name, description }) {
    const [result] = await this.pool.query(
      'INSERT INTO product_categories (name, description) VALUES (?, ?)',
      [name, description]
    );
    return this.findById(result.insertId);
  }
}

export default ProductCategory;