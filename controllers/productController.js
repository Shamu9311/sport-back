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
}

export default ProductController;