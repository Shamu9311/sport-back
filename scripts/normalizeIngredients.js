// scripts/normalizeIngredients.js — Normaliza los ingredientes del catálogo (product_nutrition → product_ingredients).
//
// Uso:
//   node scripts/normalizeIngredients.js --dry-run            -> calcula y muestra el resultado (no escribe)
//   node scripts/normalizeIngredients.js --dry-run --json     -> idem, salida JSON
//   node scripts/normalizeIngredients.js --confirm            -> escribe en DATABASE_URL (requiere migración 008)
//   NODE_ENV=test node scripts/normalizeIngredients.js        -> escribe en TEST_DATABASE_URL
//
// Solo se normalizan componentes identificables de forma confiable; lo ambiguo va a ingredient_mapping_review.
// other_components NO se modifica ni elimina.
import { connect, hasFlag } from './lib/cli.js';
import { computeNormalization, applyNormalization } from './lib/ingredientStore.js';
import { THRESHOLDS } from './lib/ingredientNormalizer.js';

function fmtItem(it) {
  const amount = it.amount == null ? 's/cantidad' : `${it.amount} ${it.unit}`;
  return `${it.ingredient_code} (${amount}, ${it.basis}, ${it.data_source}${it.form ? `, forma: ${it.form}` : ''})`;
}

export function printReport(normalization) {
  const { byProduct, productIngredients, productFormulations, reviews } = normalization;
  console.log('Umbrales:', JSON.stringify(THRESHOLDS));
  for (const [id, p] of Object.entries(byProduct)) {
    console.log(`\n#${id} ${p.name}`);
    p.items.forEach((it) => console.log(`   ✔ ${fmtItem(it)}`));
    p.formulations.forEach((f) => console.log(`   ✔ formulación ${f.formulation_code} (${f.data_source})`));
    p.reviews.forEach((r) => console.log(`   ⚠ REVISAR [${r.origin}] "${r.raw_text}" → ${r.reason}`));
    if (!p.items.length && !p.reviews.length) console.log('   (sin componentes identificables)');
  }
  const productsWithItems = Object.values(byProduct).filter((p) => p.items.length > 0).length;
  const byIngredient = {};
  productIngredients.forEach((it) => {
    byIngredient[it.ingredient_code] = (byIngredient[it.ingredient_code] || 0) + 1;
  });
  console.log('\n──────── Resumen');
  console.log(`Productos: ${Object.keys(byProduct).length} · con ≥1 ingrediente confiable: ${productsWithItems}`);
  console.log(`Filas product_ingredients: ${productIngredients.length} · formulaciones: ${productFormulations.length} · pendientes de revisión: ${reviews.length}`);
  console.log('Por ingrediente:', JSON.stringify(byIngredient));
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const client = await connect({ writes: !dryRun });
  try {
    const normalization = await computeNormalization(client);
    if (hasFlag('json')) {
      console.log(JSON.stringify({ byProduct: normalization.byProduct }, null, 2));
    } else {
      printReport(normalization);
    }
    if (dryRun) {
      console.log('\nℹ️  --dry-run: no se escribió nada.');
      return;
    }
    await client.query('BEGIN');
    const counts = await applyNormalization(client, normalization);
    await client.query('COMMIT');
    console.log('\n✅ Normalización aplicada:', JSON.stringify(counts));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('normalizeIngredients.js')) {
  main().catch((error) => {
    console.error('❌ Error normalizando ingredientes:', error.message);
    process.exit(1);
  });
}
