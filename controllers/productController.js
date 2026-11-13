import {
  Product,
  ProductCategory,
  ProductType,
  ProductNutrition,
  Flavor,
  ProductAttribute,
} from '../models/index.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

/**
 * Respuestas API: siempre `product_name` y `product_description` (compat. con filas `name`/`description` de MySQL).
 */
function normalizeProductResponse(product) {
  if (!product) return product;
  const product_name = product.product_name ?? product.name;
  const product_description = product.product_description ?? product.description;
  const {
    name: _n,
    description: _d,
    product_name: _pn,
    product_description: _pd,
    ...rest
  } = product;
  return {
    ...rest,
    product_name,
    product_description,
  };
}

/**
 * Ids de ruta/query como entero positivo de 32 bits. MariaDB convertía '"abc"' en 0 (sin filas → 404);
 * PostgreSQL lanza error 22P02, así que un id inválido se trata como "no encontrado".
 */
function parseId(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const n = Number(str);
  return n > 0 && n <= 2147483647 ? n : null;
}

function normalizeProductsList(products) {
  if (!Array.isArray(products)) return products;
  return products.map(normalizeProductResponse);
}

class ProductController {
  /**
   * Obtener todas las categorías de productos
   */
  static async getCategories(req, res) {
    try {
      const categories = await ProductCategory.findAll();
      return sendSuccess(res, 200, { data: categories });
    } catch (error) {
      console.error('Error en ProductController.getCategories:', error);
      return sendError(res, 500, 'Error al obtener categorías', error);
    }
  }

  /**
   * Obtener productos por categoría
   */
  static async getProductsByCategory(req, res) {
    try {
      const categoryId = parseId(req.params.categoryId);
      if (categoryId === null) {
        return sendError(res, 404, 'Categoría no encontrada');
      }

      const [category, products] = await Promise.all([
        ProductCategory.findById(categoryId),
        Product.findByCategory(categoryId)
      ]);

      if (!category) {
        return sendError(res, 404, 'Categoría no encontrada');
      }

      return sendSuccess(res, 200, {
        data: {
          category,
          products: normalizeProductsList(products),
        },
      });
    } catch (error) {
      console.error('Error en ProductController.getProductsByCategory:', error);
      return sendError(res, 500, 'Error al obtener productos por categoría', error);
    }
  }

  /**
   * Obtener detalles completos de un producto
   */
  static async getProductDetails(req, res) {
    try {
      const productId = parseId(req.params.productId);
      if (productId === null) {
        return sendError(res, 404, 'Producto no encontrado');
      }

      const product = await Product.findById(productId);
      if (!product) {
        return sendError(res, 404, 'Producto no encontrado');
      }

      return sendSuccess(res, 200, { data: normalizeProductResponse(product) });
    } catch (error) {
      console.error('Error en ProductController.getProductDetails:', error);
      return sendError(res, 500, 'Error al obtener detalles del producto', error);
    }
  }

  /**
   * Obtener información nutricional de un producto
   */
  static async getProductNutrition(req, res) {
    try {
      const productId = parseId(req.params.productId);
      const nutrition = productId === null ? null : await ProductNutrition.getByProduct(productId);
      return sendSuccess(res, 200, { data: nutrition || {} });
    } catch (error) {
      console.error('Error en ProductController.getProductNutrition:', error);
      return sendError(res, 500, 'Error al obtener información nutricional', error);
    }
  }

  /**
   * Obtener sabores disponibles para un producto
   */
  static async getProductFlavors(req, res) {
    try {
      const productId = parseId(req.params.productId);
      const flavors = productId === null ? [] : await Flavor.getByProduct(productId);
      return sendSuccess(res, 200, { data: flavors });
    } catch (error) {
      console.error('Error en ProductController.getProductFlavors:', error);
      return sendError(res, 500, 'Error al obtener sabores del producto', error);
    }
  }

  /**
   * Obtener atributos específicos de un producto
   */
  static async getProductAttributes(req, res) {
    try {
      const productId = parseId(req.params.productId);
      const attributes = productId === null ? [] : await ProductAttribute.getByProduct(productId);
      return sendSuccess(res, 200, { data: attributes });
    } catch (error) {
      console.error('Error en ProductController.getProductAttributes:', error);
      return sendError(res, 500, 'Error al obtener atributos del producto', error);
    }
  }

  /**
   * Obtener todos los datos de un producto en un solo endpoint
   */
  static async getFullProductDetails(req, res) {
    try {
      const productId = parseId(req.params.productId);
      if (productId === null) {
        return sendError(res, 404, 'Producto no encontrado');
      }

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
        return sendError(res, 404, 'Producto no encontrado');
      }

      return sendSuccess(res, 200, {
        data: {
          ...normalizeProductResponse(product),
          nutrition: nutrition || {},
          flavors: flavors || [],
          attributes: attributes || [],
        },
      });
    } catch (error) {
      console.error('Error en ProductController.getFullProductDetails:', error);
      return sendError(res, 500, 'Error al obtener detalles completos del producto', error);
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
        type = '',           // ID de tipo de producto
        limit = 10,          // Límite de resultados por página
        offset = 0           // Offset para paginación
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

      // Placeholder posicional de PostgreSQL ($1, $2, ...)
      const addParam = (value) => {
        params.push(value);
        return `$${params.length}`;
      };

      // Filtro de búsqueda por texto: ILIKE (sin mayúsculas) + unaccent (sin tildes), como hacía MariaDB general_ci
      if (q && q.trim() !== '') {
        const searchTerm = addParam(`%${q.trim()}%`);
        conditions.push(
          `(extensions.unaccent(p.name) ILIKE extensions.unaccent(${searchTerm}) OR extensions.unaccent(COALESCE(p.description, '')) ILIKE extensions.unaccent(${searchTerm}))`
        );
      }

      // Filtro por categoría
      if (category && category !== '') {
        const categoryId = parseId(category);
        conditions.push(categoryId === null ? 'FALSE' : `pc.category_id = ${addParam(categoryId)}`);
      }

      // Filtro por tipo de producto
      if (type && type !== '') {
        const typeId = parseId(type);
        conditions.push(typeId === null ? 'FALSE' : `pt.type_id = ${addParam(typeId)}`);
      }

      // Filtro por timing - mapear a usage_context de product_categories
      if (timing && timing !== '') {
        const timingMap = {
          'antes': 'pre entrenamiento',
          'durante': 'durante entrenamiento',
          'despues': 'post entrenamiento'
        };

        const usageContext = timingMap[timing] || timing;
        conditions.push(`pc.usage_context = ${addParam(usageContext)}`);
      }

      // Siempre filtrar productos activos
      conditions.push('p.is_active = TRUE');

      // Construir query de conteo (sin cambios en la estructura)
      let countQuery = `
        SELECT COUNT(DISTINCT p.product_id)::int as total
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.type_id
        LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
      `;

      // Agregar condiciones WHERE
      const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
      query += whereClause;
      countQuery += whereClause;

      // Contar total
      const countParams = params.slice();
      const { rows: countResult } = await Product.pool.query(countQuery, countParams);
      const total = countResult[0]?.total || 0;

      // Ordenar por nombre y aplicar paginación
      const safeLimit = Number.isFinite(parseInt(limit, 10)) ? Math.max(parseInt(limit, 10), 0) : 10;
      const safeOffset = Number.isFinite(parseInt(offset, 10)) ? Math.max(parseInt(offset, 10), 0) : 0;
      query += ' ORDER BY p.name ASC, p.product_id ASC';
      query += ` LIMIT ${addParam(safeLimit)} OFFSET ${addParam(safeOffset)}`;

      const { rows: products } = await Product.pool.query(query, params);

      return sendSuccess(res, 200, {
        data: {
          products: normalizeProductsList(products || []),
          count: products.length,
          total,
          hasMore: (parseInt(offset) + parseInt(limit)) < total,
          filters: { q, category, timing, type },
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            total
          }
        },
      });
    } catch (error) {
      console.error('Error en ProductController.searchProducts:', error);
      return sendError(res, 500, 'Error al buscar productos', error);
    }
  }
}

export default ProductController;