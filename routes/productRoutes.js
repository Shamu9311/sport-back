// routes/productRoutes.js
import express from 'express';
import ProductController from '../controllers/productController.js';

const router = express.Router();

// Búsqueda debe ir antes de las rutas con parámetros
router.get('/search', ProductController.searchProducts);
router.get('/categories', ProductController.getCategories);
router.get('/category/:categoryId', ProductController.getProductsByCategory);
router.get('/:productId', ProductController.getProductDetails);
router.get('/:productId/nutrition', ProductController.getProductNutrition);
router.get('/:productId/flavors', ProductController.getProductFlavors);
router.get('/:productId/attributes', ProductController.getProductAttributes);
router.get('/:productId/full', ProductController.getFullProductDetails);

export default router;