// Script para ejecutar una sola vez (o cuando agregues productos)
import { generateProductEmbedding } from '../services/embeddingServices.js';
import { createConnection } from '../config/db.js';

const db = createConnection();

async function generateAllProductEmbeddings() {
  try {
    // Obtener todos los productos
    const [products] = await db.query(`
      SELECT p.*, 
             pt.name as type_name, 
             pc.name as category_name,
             pn.protein_g, 
             pn.carbs_g,
             pn.energy_kcal,
             pn.caffeine_mg,
             GROUP_CONCAT(DISTINCT pa.name) as attributes
      FROM products p
      LEFT JOIN product_types pt ON p.type_id = pt.type_id
      LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
      LEFT JOIN product_nutrition pn ON p.product_id = pn.product_id
      LEFT JOIN product_attributes_mapping pam ON p.product_id = pam.product_id
      LEFT JOIN product_attributes pa ON pam.attribute_id = pa.attribute_id
      WHERE p.is_active = 1
      GROUP BY p.product_id
    `);
    
    console.log(`🚀 Generando embeddings para ${products.length} productos...`);
    console.log(`📊 Modelo: ${process.env.EMBEDDING_MODEL || 'text-embedding-3-small'}`);
    console.log(`⏱️  Tiempo estimado: ~${products.length * 0.5} segundos\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      
      try {
        // Generar embedding
        const embedding = await generateProductEmbedding(product);
        
        if (!embedding || embedding.length === 0) {
          throw new Error('Empty embedding returned');
        }
        
        // Guardar en BD
        await db.query(`
          INSERT INTO product_embeddings (product_id, embedding, created_at)
          VALUES (?, ?, NOW())
          ON DUPLICATE KEY UPDATE embedding = ?, updated_at = NOW()
        `, [product.product_id, JSON.stringify(embedding), JSON.stringify(embedding)]);
        
        successCount++;
        console.log(`✅ [${i + 1}/${products.length}] ${product.name}`);
        
        // Delay para no sobrepasar rate limits de OpenAI (3000 RPM)
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error con producto ${product.name}:`, error.message);
      }
    }
    
    console.log(`\n🎉 Proceso completado!`);
    console.log(`✅ Exitosos: ${successCount}`);
    console.log(`❌ Errores: ${errorCount}`);
    console.log(`\n💡 Ahora puedes usar búsqueda vectorial en las recomendaciones.`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

generateAllProductEmbeddings();