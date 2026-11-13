// scripts/generateProductEmbeddings.js — (Re)genera embeddings de productos con Gemini en vector(768).
//
// Uso:
//   node scripts/generateProductEmbeddings.js --missing --confirm     -> solo productos sin embedding (recomendado)
//   node scripts/generateProductEmbeddings.js --all --confirm         -> todos los productos activos
//   node scripts/generateProductEmbeddings.js --product=12 --confirm  -> un producto
//   node scripts/generateProductEmbeddings.js --missing --dry-run     -> lista qué generaría
import { connect, flagValue, hasFlag } from './lib/cli.js';
import { loadProductsForEmbedding, regenerateEmbeddings } from './lib/productEmbeddings.js';

async function main() {
  const productArg = flagValue('product');
  const productIds = productArg ? productArg.split(',').map((v) => parseInt(v, 10)).filter(Number.isInteger) : null;
  const onlyMissing = hasFlag('missing') || (!hasFlag('all') && !productIds);

  const client = await connect({ writes: true });
  try {
    if (hasFlag('dry-run')) {
      const products = await loadProductsForEmbedding(client, { productIds, onlyMissing });
      console.log(`ℹ️  --dry-run: se generarían ${products.length} embeddings:`);
      products.forEach((p) => console.log(`  - ${p.product_id} ${p.name}`));
      return;
    }
    const summary = await regenerateEmbeddings(client, { productIds, onlyMissing });
    console.log(`\n🎉 Exitosos: ${summary.ok} · Errores: ${summary.failed.length}`);
    if (summary.failed.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌ Error fatal:', error.message);
  process.exit(1);
});
