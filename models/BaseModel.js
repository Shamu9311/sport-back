// models/BaseModel.js (Opcional - para herencia)
import pool from '../config/db.js';

export class BaseModel {
  static tableName = ''; // Sobreescribir en cada modelo
  static pool = pool; // Exponer el pool para que las clases hijas puedan acceder a él
  static primaryKey = 'id'; // Agregar propiedad primaryKey para especificar la columna de ID

  static async findById(id) {
    // Usar la columna de ID específica para cada tabla
    const idColumn = this.primaryKey || 'id';
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE ${idColumn} = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findAll() {
    // PostgreSQL no garantiza orden sin ORDER BY (MariaDB devolvía por PK)
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableName} ORDER BY ${this.primaryKey || 'id'}`
    );
    return rows;
  }

  // Métodos comunes...
}
