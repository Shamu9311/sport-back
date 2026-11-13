import { BaseModel } from './BaseModel.js';

class Flavor extends BaseModel {
  static tableName = 'flavors';
  static primaryKey = 'flavor_id';

  static async getByProduct(productId) {
    const { rows } = await this.pool.query(`
      SELECT f.* 
      FROM flavors f
      JOIN product_flavors pf ON f.flavor_id = pf.flavor_id
      WHERE pf.product_id = $1
      ORDER BY f.flavor_id
    `, [productId]);
    return rows;
  }
}

export default Flavor;
