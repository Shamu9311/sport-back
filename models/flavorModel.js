import { BaseModel } from './BaseModel.js';

class Flavor extends BaseModel {
  static tableName = 'flavors';
  static primaryKey = 'id'; // Especificar la clave primaria

  static async getPopular(limit = 5) {
    const [rows] = await this.pool.query(`
      SELECT f.*, COUNT(pf.product_id) as product_count
      FROM flavors f
      LEFT JOIN product_flavors pf ON f.id = pf.flavor_id
      GROUP BY f.id
      ORDER BY product_count DESC
      LIMIT ?
    `, [limit]);
    return rows;
  }

  static async getByProduct(productId) {
  const [flavors] = await this.pool.query(`
    SELECT f.* 
    FROM flavors f
    JOIN product_flavors pf ON f.flavor_id = pf.flavor_id
    WHERE pf.product_id = ?
  `, [productId]);
  return flavors;
}
}

export default Flavor;