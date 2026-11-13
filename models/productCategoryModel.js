import { BaseModel } from './BaseModel.js';

class ProductCategory extends BaseModel {
  static tableName = 'product_categories';
  static primaryKey = 'category_id';

  static async createWithImage({ name, description }) {
    const { rows } = await this.pool.query(
      'INSERT INTO product_categories (name, description) VALUES ($1, $2) RETURNING category_id',
      [name, description]
    );
    return this.findById(rows[0].category_id);
  }
}

export default ProductCategory;
