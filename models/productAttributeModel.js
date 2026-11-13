import { BaseModel } from './BaseModel.js';
import { withTransaction } from '../config/db.js';

class ProductAttribute extends BaseModel {
  static tableName = 'product_attributes';
  static primaryKey = 'attribute_id';

  static async getByProduct(productId) {
    const { rows } = await this.pool.query(`
      SELECT pa.* 
      FROM product_attributes pa
      JOIN product_attributes_mapping pam ON pa.attribute_id = pam.attribute_id
      WHERE pam.product_id = $1
      ORDER BY pa.attribute_id
    `, [productId]);
    return rows;
  }

  static async createAttributeGroup(attributes) {
    return withTransaction(async (client) => {
      const attributeIds = [];
      for (const attr of attributes) {
        const { rows } = await client.query(
          'INSERT INTO product_attributes (name) VALUES ($1) RETURNING attribute_id',
          [attr.name]
        );
        attributeIds.push(rows[0].attribute_id);
      }
      return attributeIds;
    });
  }
}

export default ProductAttribute;
