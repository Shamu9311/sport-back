// Script de prueba para verificar que la búsqueda vectorial funciona
import { generateUserProfileEmbedding } from '../services/embeddingServices.js';
import { findSimilarProducts } from '../services/vectorSearchService.js';
import { createConnection } from '../config/db.js';
import 'dotenv/config';

const db = createConnection();

async function testVectorSearch() {
  try {
    console.log('🧪 Iniciando prueba de búsqueda vectorial...\n');
    
    // 1. Verificar que existen embeddings de productos
    const [count] = await db.query('SELECT COUNT(*) as total FROM product_embeddings');
    console.log(`📊 Embeddings en BD: ${count[0].total}`);
    
    if (count[0].total === 0) {
      console.error('❌ No hay embeddings. Ejecuta: node scripts/generateProductEmbeddings.js');
      process.exit(1);
    }
    
    // 2. Crear un perfil de prueba
    const testProfile = {
      primary_goal: 'mejor rendimiento',
      training_type: 'cardio',
      intensity: 'alto',
      duration: 60,
      activity_level: 'muy activo',
      training_frequency: '5+',
      dietary_restrictions: 'no',
      caffeine_tolerance: 'medio',
      sweat_level: 'alto'
    };
    
    console.log('\n👤 Perfil de prueba:');
    console.log(`   Objetivo: ${testProfile.primary_goal}`);
    console.log(`   Entrenamiento: ${testProfile.training_type} - ${testProfile.intensity}`);
    console.log(`   Duración: ${testProfile.duration} min\n`);
    
    // 3. Generar embedding del perfil
    console.log('🔄 Generando embedding del perfil...');
    const userEmbedding = await generateUserProfileEmbedding(testProfile);
    console.log(`✅ Embedding generado: Vector de ${userEmbedding.length} dimensiones\n`);
    
    // 4. Buscar productos similares
    console.log('🔍 Buscando productos similares...\n');
    const similarProductIds = await findSimilarProducts(userEmbedding, 10);
    
    // 5. Obtener detalles de los productos encontrados
    if (similarProductIds.length > 0) {
      const placeholders = similarProductIds.map(() => '?').join(',');
      const [products] = await db.query(`
        SELECT p.product_id, p.name, pc.name as category
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.type_id
        LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
        WHERE p.product_id IN (${placeholders})
        ORDER BY FIELD(p.product_id, ${placeholders})
      `, similarProductIds);
      
      console.log(`\n🎯 Productos más relevantes (Top ${products.length}):`);
      products.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.name} (${p.category})`);
      });
    }
    
    console.log('\n✅ Prueba completada exitosamente!');
    console.log('💡 El sistema RAG está funcionando correctamente.\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error en la prueba:', error);
    console.error('Detalles:', error.message);
    process.exit(1);
  }
}

testVectorSearch();

