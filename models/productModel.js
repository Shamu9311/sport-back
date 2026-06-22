import { BaseModel } from './BaseModel.js';

class Product extends BaseModel {
  static tableName = 'products';
  static primaryKey = 'product_id'; // Corrección: usar product_id en lugar de id

  static async findByCategory(categoryId) {
    const [rows] = await this.pool.query(
      `SELECT p.* FROM products p
       INNER JOIN product_types pt ON p.type_id = pt.type_id
       WHERE pt.category_id = ?`,
      [categoryId]
    );
    return rows;
  }

  static async createWithAttributes({ name, typeId, description, attributes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [productResult] = await connection.query(
        'INSERT INTO products (name, type_id, description) VALUES (?, ?, ?)',
        [name, typeId, description || null]
      );

      const productId = productResult.insertId;
      
      // Insertar atributos relacionados vía tabla de mapeo
      for (const attr of attributes) {
        await connection.query(
          'INSERT INTO product_attributes_mapping (product_id, attribute_id) VALUES (?, ?)',
          [productId, attr.attributeId]
        );
      }

      await connection.commit();
      return this.findById(productId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export default Product;