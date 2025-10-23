import { BaseModel } from './BaseModel.js';

class ProductAttribute extends BaseModel {
  static tableName = 'product_attributes';

  static async getByProduct(productId) {
    const [attributes] = await this.pool.query(`
      SELECT pa.* 
      FROM product_attributes pa
      JOIN product_attributes_mapping pam ON pa.attribute_id = pam.attribute_id
      WHERE pam.product_id = ?
    `, [productId]);
    return attributes;
  }

  static async createAttributeGroup(attributes) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      
      const attributeIds = [];
      for (const attr of attributes) {
        const [result] = await connection.query(
          'INSERT INTO product_attributes (name, value_type) VALUES (?, ?)',
          [attr.name, attr.valueType]
        );
        attributeIds.push(result.insertId);
      }
      
      await connection.commit();
      return attributeIds;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } 
}

export default ProductAttribute;