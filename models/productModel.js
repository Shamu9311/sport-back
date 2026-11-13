import { BaseModel } from './BaseModel.js';
import { withTransaction } from '../config/db.js';

class Product extends BaseModel {
  static tableName = 'products';
  static primaryKey = 'product_id'; // Corrección: usar product_id en lugar de id

  static async findByCategory(categoryId) {
    const { rows } = await this.pool.query(
      `SELECT p.* FROM products p
       INNER JOIN product_types pt ON p.type_id = pt.type_id
       WHERE pt.category_id = $1
       ORDER BY p.product_id`,
      [categoryId]
    );
    return rows;
  }

  static async createWithAttributes({ name, typeId, description, attributes }) {
    const productId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO products (name, type_id, description) VALUES ($1, $2, $3) RETURNING product_id',
        [name, typeId, description || null]
      );
      const newProductId = rows[0].product_id;

      // Insertar atributos relacionados vía tabla de mapeo
      for (const attr of attributes) {
        await client.query(
          'INSERT INTO product_attributes_mapping (product_id, attribute_id) VALUES ($1, $2)',
          [newProductId, attr.attributeId]
        );
      }
      return newProductId;
    });
    return this.findById(productId);
  }
}

export default Product;
