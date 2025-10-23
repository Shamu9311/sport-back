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

  static async createWithAttributes({ name, price, categoryId, attributes }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [productResult] = await connection.query(
        'INSERT INTO products (name, price, category_id) VALUES (?, ?, ?)',
        [name, price, categoryId]
      );

      const productId = productResult.insertId;
      
      // Insertar atributos relacionados
      for (const attr of attributes) {
        await connection.query(
          'INSERT INTO product_attributes (product_id, name, value) VALUES (?, ?, ?)',
          [productId, attr.name, attr.value]
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