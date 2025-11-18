import { 
  Product, 
  ProductCategory, 
  ProductType,
  ProductNutrition,
  Flavor,
  ProductAttribute 
} from '../models/index.js';

class ProductController {
  /**
   * Obtener todas las categorías de productos
   */
  static async getCategories(req, res) {
    try {
      const categories = await ProductCategory.findAll();
      res.json(categories);
    } catch (error) {
      console.error('Error en ProductController.getCategories:', error);
      res.status(500).json({ 
        message: 'Error al obtener categorías',
        error: error.message 
      });
    }
  }

  /**
   * Obtener productos por categoría
   */
  static async getProductsByCategory(req, res) {
    try {
      const { categoryId } = req.params;
      
      const [category, products] = await Promise.all([
        ProductCategory.findById(categoryId),
        Product.findByCategory(categoryId)
      ]);

      if (!category) {
        return res.status(404).json({ message: 'Categoría no encontrada' });
      }

      res.json({
        category,
        products
      });
    } catch (error) {
      console.error('Error en ProductController.getProductsByCategory:', error);
      res.status(500).json({ 
        message: 'Error al obtener productos por categoría',
        error: error.message 
      });
    }
  }

  /**
   * Obtener detalles completos de un producto
   */
  static async getProductDetails(req, res) {
    try {
      const { productId } = req.params;
      
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: 'Producto no encontrado' });
      }

      res.json(product);
    } catch (error) {
      console.error('Error en ProductController.getProductDetails:', error);
      res.status(500).json({ 
        message: 'Error al obtener detalles del producto',
        error: error.message 
      });
    }
  }

  /**
   * Obtener información nutricional de un producto
   */
  static async getProductNutrition(req, res) {
    try {
      const { productId } = req.params;
      const nutrition = await ProductNutrition.getByProduct(productId);
      res.json(nutrition || {});
    } catch (error) {
      console.error('Error en ProductController.getProductNutrition:', error);
      res.status(500).json({ 
        message: 'Error al obtener información nutricional',
        error: error.message 
      });
    }
  }

  /**
   * Obtener sabores disponibles para un producto
   */
  static async getProductFlavors(req, res) {
    try {
      const { productId } = req.params;
      const flavors = await Flavor.getByProduct(productId);
      res.json(flavors);
    } catch (error) {
      console.error('Error en ProductController.getProductFlavors:', error);
      res.status(500).json({ 
        message: 'Error al obtener sabores del producto',
        error: error.message 
      });
    }
  }

  /**
   * Obtener atributos específicos de un producto
   */
  static async getProductAttributes(req, res) {
    try {
      const { productId } = req.params;
      const attributes = await ProductAttribute.getByProduct(productId);
      res.json(attributes);
    } catch (error) {
      console.error('Error en ProductController.getProductAttributes:', error);
      res.status(500).json({ 
        message: 'Error al obtener atributos del producto',
        error: error.message 
      });
    }
  }

  /**
   * Obtener todos los datos de un producto en un solo endpoint
   */
  static async getFullProductDetails(req, res) {
    try {
      const { productId } = req.params;
      
      const [
        product,
        nutrition,
        flavors,
        attributes
      ] = await Promise.all([
        Product.findById(productId),
        ProductNutrition.getByProduct(productId),
        Flavor.getByProduct(productId),
        ProductAttribute.getByProduct(productId)
      ]);

      if (!product) {
        return res.status(404).json({ message: 'Producto no encontrado' });
      }

      res.json({
        ...product,
        nutrition: nutrition || {},
        flavors: flavors || [],
        attributes: attributes || []
      });
    } catch (error) {
      console.error('Error en ProductController.getFullProductDetails:', error);
      res.status(500).json({ 
        message: 'Error al obtener detalles completos del producto',
        error: error.message 
      });
    }
  }

  /**
   * Búsqueda y filtrado de productos
   */
  static async searchProducts(req, res) {
    try {
      const { 
        q = '',              // Texto de búsqueda
        category = '',       // ID de categoría
        timing = '',         // Timing de consumo: antes, durante, despues, diario
        type = ''           // ID de tipo de producto
      } = req.query;

      let query = `
        SELECT DISTINCT p.*, 
               pt.name as type_name,
               pc.name as category_name
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.type_id
        LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
      `;
      
      const conditions = [];
      const params = [];

      // Filtro de búsqueda por texto
      if (q && q.trim() !== '') {
        conditions.push('(p.name LIKE ? OR p.description LIKE ?)');
        const searchTerm = `%${q.trim()}%`;
        params.push(searchTerm, searchTerm);
      }

      // Filtro por categoría
      if (category && category !== '') {
        conditions.push('pc.category_id = ?');
        params.push(category);
      }

      // Filtro por tipo de producto
      if (type && type !== '') {
        conditions.push('pt.type_id = ?');
        params.push(type);
      }

      // Filtro por timing - necesita JOIN con recommendations
      if (timing && timing !== '') {
        query = `
          SELECT DISTINCT p.*, 
                 pt.name as type_name,
                 pc.name as category_name,
                 r.consumption_timing
          FROM products p
          LEFT JOIN product_types pt ON p.type_id = pt.type_id
          LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
          INNER JOIN recommendations r ON p.product_id = r.product_id
        `;
        conditions.push('r.consumption_timing = ?');
        params.push(timing);
      }

      // Siempre filtrar productos activos
      conditions.push('p.is_active = 1');

      // Agregar condiciones WHERE
      query += ' WHERE ' + conditions.join(' AND ');

      // Ordenar por nombre
      query += ' ORDER BY p.name ASC';

      const [products] = await Product.pool.query(query, params);
      
      res.json({
        products: products || [],
        count: products.length,
        filters: { q, category, timing, type }
      });
    } catch (error) {
      console.error('Error en ProductController.searchProducts:', error);
      res.status(500).json({ 
        message: 'Error al buscar productos',
        error: error.message 
      });
    }
  }
}

export default ProductController;