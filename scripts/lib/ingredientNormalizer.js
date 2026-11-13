// scripts/lib/ingredientNormalizer.js — Normalización de ingredientes (lógica pura, sin BD).
//
// Principio: solo se normaliza lo que se identifica de forma CONFIABLE. Nunca se inventan cantidades,
// unidades ni ingredientes. Todo lo ambiguo o contradictorio va a la lista de revisión manual.
//
// Fuentes de datos (en orden de prioridad para cantidades):
//   1. nutrition_column    — columnas numéricas de product_nutrition (caffeine_mg, carbs_g, ...)
//   2. other_components    — texto libre de product_nutrition, solo patrones reconocibles
//   3. product_description — reglas explícitas sobre la descripción (lista PRODUCT_DESCRIPTION_RULES)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../../data/evidence');

export function loadCatalogs(dataDir = DATA_DIR) {
  const ingredients = JSON.parse(fs.readFileSync(path.join(dataDir, 'ingredients.json'), 'utf8')).ingredients;
  const formulations = JSON.parse(fs.readFileSync(path.join(dataDir, 'formulations.json'), 'utf8')).formulations;
  return { ingredients, formulations };
}

// Ingredientes genéricos que NO se asignan a productos sin detalle (p. ej. "Electrolyte blend")
const NON_ASSIGNABLE = new Set(['electrolytes']);

// Umbrales documentados
export const THRESHOLDS = {
  carbohydrate_g_min: 1, // < 1 g se considera traza y no se registra
  protein_g_min: 1,
  sodium_mg_plausible_min: 10, // 0 < sodio < 10 mg: probable dato en gramos guardado como mg → revisión
};

const MARKETING_WORDS = /\b(blend|formulation|formula|zero calories|advanced|active|antioxidant)\b/i;
const FOOD_WORDS = /\b(fruit|filling|dates|banana|puree|berry|chocolate)\b/i;

/** Reglas explícitas sobre la descripción del producto (cada una auditable). */
export const PRODUCT_DESCRIPTION_RULES = [
  {
    id: 'desc-mdx-fru-1-0-8',
    pattern: /1:0\.8\s*maltodextrina:fructosa/i,
    apply: () => ({
      items: [
        { code: 'maltodextrin', amount: 1, unit: 'ratio' },
        { code: 'fructose', amount: 0.8, unit: 'ratio' },
      ],
    }),
  },
  {
    id: 'desc-whey-grams',
    pattern: /(\d+(?:\.\d+)?)\s*g\s*(?:de\s*)?prote[ií]na de suero/i,
    apply: (m) => ({ items: [{ code: 'whey_protein', amount: Number(m[1]), unit: 'g' }] }),
  },
  {
    id: 'desc-fructose-grams',
    pattern: /(\d+(?:\.\d+)?)\s*g\s*fructosa/i,
    apply: (m) => ({ items: [{ code: 'fructose', amount: Number(m[1]), unit: 'g' }] }),
  },
  {
    id: 'desc-vitamin-c-mg',
    pattern: /(\d+(?:\.\d+)?)\s*mg\s*vitamina\s*c/i,
    apply: (m) => ({ items: [{ code: 'vitamin_c', amount: Number(m[1]), unit: 'mg' }] }),
  },
  {
    id: 'desc-iron-mg',
    pattern: /(\d+(?:\.\d+)?)\s*mg\s*hierro/i,
    apply: (m) => ({ items: [{ code: 'iron', amount: Number(m[1]), unit: 'mg' }] }),
  },
];

const UNIT_MAP = { mg: 'mg', g: 'g', 'µg': 'ug', 'μg': 'ug', ug: 'ug', mcg: 'ug', iu: 'iu', ml: 'ml' };
const TO_MG = { g: 1000, mg: 1, ug: 0.001 };

function normalizeText(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/®|™/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAliasIndex(ingredients) {
  const index = new Map();
  for (const ing of ingredients) {
    for (const alias of [ing.code, ing.display_name, ...(ing.aliases || [])]) {
      index.set(normalizeText(alias), ing.code);
    }
  }
  return index;
}

function lookup(index, name) {
  const key = normalizeText(name);
  if (index.has(key)) return index.get(key);
  // Variantes simples: sin prefijo "l-" y sin plural final
  const variants = [key.replace(/^l-/, ''), key.replace(/s$/, '')];
  for (const v of variants) if (index.has(v)) return index.get(v);
  return null;
}

function basisFor(row, rowsOfProduct) {
  const serving = normalizeText(row.serving_size);
  if (/^100 ?g$/.test(serving)) return 'per_100g';
  if (rowsOfProduct.length > 1 && /\b(por|per)\b/.test(serving)) return 'per_unit';
  return 'per_serving';
}

/** Divide por comas de primer nivel (respeta paréntesis). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(mg|g|µg|μg|ug|mcg|iu|ml)\b\.?$/i;

/**
 * Analiza other_components de UNA fila de nutrición.
 * @returns {{ items: object[], reviews: object[] }}
 */
export function parseOtherComponents(raw, aliasIndex) {
  const items = [];
  const reviews = [];
  const text = String(raw || '').trim();
  if (!text || /^none$/i.test(text)) return { items, reviews };

  // Patrón de proporción: "Maltodextrin:Fructose 1:0.8" / "Leucine:Isoleucine:Valine 2:1:1"
  const ratio = text.match(/^([A-Za-zÀ-ÿ\- ]+(?::[A-Za-zÀ-ÿ\- ]+)+)\s+(\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)+)$/);
  if (ratio) {
    const names = ratio[1].split(':').map((s) => s.trim());
    const parts = ratio[2].split(':').map(Number);
    const codes = names.map((n) => lookup(aliasIndex, n));
    if (names.length === parts.length && codes.every(Boolean)) {
      codes.forEach((code, i) => items.push({ code, amount: parts[i], unit: 'ratio', raw: text }));
      if (['leucine', 'isoleucine', 'valine'].every((c) => codes.includes(c))) {
        items.push({ code: 'bcaa', raw: text, notes: 'Leucina, isoleucina y valina son los BCAA (definición).' });
      }
    } else {
      reviews.push({ raw_text: text, reason: 'Proporción con ingredientes no reconocidos en el catálogo.' });
    }
    return { items, reviews };
  }

  // Patrón de lista de vitaminas: "Vitamins A, D, E, C, B-complex"
  // Solo si TODOS los elementos son letras de vitamina o "B-complex" (evita tratar "Vitamin C, Zinc, Iron" como lista)
  const vitamins = text.match(/^vitamins?\s+(.+)$/i);
  const vitaminTokens = vitamins
    ? vitamins[1].split(/,|\by\b|\band\b/i).map((t) => t.trim()).filter(Boolean)
    : [];
  if (vitamins && vitaminTokens.every((t) => /^[a-z]$/i.test(t) || /^b[- ]?complex$/i.test(t))) {
    for (const token of vitamins[1].split(/,|\by\b|\band\b/i).map((t) => t.trim()).filter(Boolean)) {
      const code = /^[a-z]$/i.test(token) ? lookup(aliasIndex, `vitamin ${token}`) : null;
      if (code) items.push({ code, raw: text });
      else reviews.push({ raw_text: token, reason: `Vitamina no específica ("${token}"): no se asume su composición.` });
    }
    return { items, reviews };
  }

  for (const token of splitTopLevel(text)) {
    const paren = token.match(/\(([^)]*)\)/);
    const main = token.replace(/\([^)]*\)/g, '').trim();
    if (paren && /\d/.test(paren[1])) {
      reviews.push({
        raw_text: token,
        suggested_code: lookup(aliasIndex, paren[1].replace(/^incl\.?\s*/i, '').replace(AMOUNT_RE, '').trim()),
        reason: `Detalle entre paréntesis no confirmado o incoherente ("${paren[1]}"); se registra solo la parte principal.`,
      });
    }

    const amountMatch = main.match(AMOUNT_RE);
    const name = amountMatch ? main.slice(0, amountMatch.index).trim() : main;
    const formAnhydrous = /anhydrous|anhidra/i.test(name);
    const formCognizin = /cognizin/i.test(name);
    const code = lookup(aliasIndex, name) || lookup(aliasIndex, name.replace(/anhydrous|anhidra/i, '').trim());

    if (!code) {
      let reason = 'Componente no reconocido en el catálogo de ingredientes.';
      if (MARKETING_WORDS.test(name)) reason = 'Descriptor comercial sin ingrediente identificable.';
      else if (FOOD_WORDS.test(name)) reason = 'Ingrediente alimentario; propuesta: no mapear (sin relevancia para la evidencia de suplementos).';
      else if (/dual source/i.test(name)) reason = 'No declara las fuentes ni la proporción de carbohidratos; no se asume 1:0.8.';
      reviews.push({ raw_text: token, reason });
      continue;
    }
    if (NON_ASSIGNABLE.has(code)) {
      reviews.push({ raw_text: token, suggested_code: code, reason: 'Mezcla genérica sin detalle de componentes (los electrolitos con cantidad salen de las columnas).' });
      continue;
    }
    const item = { code, raw: token };
    if (amountMatch) {
      item.amount = Number(amountMatch[1].replace(',', '.'));
      item.unit = UNIT_MAP[amountMatch[2].toLowerCase()] || null;
    }
    if (formAnhydrous) item.form = 'anhydrous';
    if (formCognizin) item.form = 'Cognizin®';
    items.push(item);
  }
  return { items, reviews };
}

function sameAmount(a, b) {
  if (a.amount == null || b.amount == null) return true;
  if (a.unit === b.unit) return Math.abs(a.amount - b.amount) < 1e-6;
  if (TO_MG[a.unit] && TO_MG[b.unit]) return Math.abs(a.amount * TO_MG[a.unit] - b.amount * TO_MG[b.unit]) < 1e-6;
  return false;
}

/**
 * Normaliza el catálogo completo.
 * @param {Array} products filas { product_id, name, type_id, type_name, description, nutrition: [...] }
 */
export function normalizeProducts(products, catalogs) {
  const aliasIndex = buildAliasIndex(catalogs.ingredients);
  const result = { productIngredients: [], productFormulations: [], reviews: [], byProduct: {} };

  // Hermanos por tipo con cafeína > 0 (para detectar ceros sospechosos, p. ej. variantes "+ Nootropics")
  const caffeineByType = new Map();
  for (const p of products) {
    const max = Math.max(0, ...p.nutrition.map((n) => Number(n.caffeine_mg) || 0));
    caffeineByType.set(p.type_id, Math.max(caffeineByType.get(p.type_id) || 0, max));
  }

  for (const p of products) {
    const found = new Map(); // key code|basis → item
    const reviews = [];
    const addReview = (r) => reviews.push({ product_id: p.product_id, ...r });

    const add = (item) => {
      const key = `${item.code}|${item.basis}`;
      const prev = found.get(key);
      if (!prev) {
        found.set(key, item);
        return;
      }
      if (!sameAmount(prev, item)) {
        found.delete(key);
        addReview({
          origin: item.data_source,
          raw_text: `${item.code}: ${prev.amount}${prev.unit || ''} (${prev.data_source}) vs ${item.amount}${item.unit || ''} (${item.data_source})`,
          suggested_code: item.code,
          reason: 'Cantidades contradictorias entre fuentes internas del producto.',
        });
        return;
      }
      // Misma información: conservar la de mayor prioridad y completar forma/cantidad faltantes
      if (prev.amount == null && item.amount != null) {
        prev.amount = item.amount;
        prev.unit = item.unit;
      }
      if (!prev.form && item.form) prev.form = item.form;
    };

    for (const row of p.nutrition) {
      const basis = basisFor(row, p.nutrition);
      const col = (code, value, unit) =>
        add({ code, amount: Number(value), unit, basis, data_source: 'nutrition_column', serving_description: row.serving_size });
      const caf = Number(row.caffeine_mg);
      if (caf > 0) col('caffeine', caf, 'mg');
      else if (caffeineByType.get(p.type_id) > 0) {
        addReview({
          origin: 'nutrition_column',
          raw_text: `caffeine_mg=${row.caffeine_mg ?? 'NULL'} (${row.serving_size || 'sin porción'})`,
          suggested_code: 'caffeine',
          reason: 'Otro producto de la misma línea declara cafeína > 0; posible dato faltante. No se asume la cafeína.',
        });
      }
      if (Number(row.carbs_g) >= THRESHOLDS.carbohydrate_g_min) col('carbohydrate', row.carbs_g, 'g');
      if (Number(row.protein_g) >= THRESHOLDS.protein_g_min) col('protein', row.protein_g, 'g');
      const na = Number(row.sodium_mg);
      if (na >= THRESHOLDS.sodium_mg_plausible_min) col('sodium', na, 'mg');
      else if (na > 0) {
        addReview({
          origin: 'nutrition_column',
          raw_text: `sodium_mg=${row.sodium_mg} (${row.serving_size || 'sin porción'})`,
          suggested_code: 'sodium',
          reason: 'Valor de sodio inverosímil en mg; probable dato en gramos guardado en la columna de mg. No se convierte sin confirmar.',
        });
      }
      if (Number(row.potassium_mg) > 0) col('potassium', row.potassium_mg, 'mg');
      if (Number(row.magnesium_mg) > 0) col('magnesium', row.magnesium_mg, 'mg');

      const { items, reviews: ocReviews } = parseOtherComponents(row.other_components, aliasIndex);
      for (const it of items) {
        const itemBasis = it.unit === 'ratio' || it.amount == null ? 'unspecified' : basis;
        // Texto que contradice una columna explícita (p. ej. "Sodio 0.9g" con sodium_mg = 0)
        const colValue = { sodium: row.sodium_mg, caffeine: row.caffeine_mg, potassium: row.potassium_mg, magnesium: row.magnesium_mg }[it.code];
        if (it.amount != null && colValue != null && Number(colValue) === 0) {
          addReview({
            origin: 'other_components',
            raw_text: it.raw,
            suggested_code: it.code,
            reason: `El texto declara ${it.amount} ${it.unit} pero la columna numérica es 0: datos contradictorios.`,
          });
          continue;
        }
        // Mención sin cantidad de un ingrediente ya registrado (p. ej. "Caffeine anhydrous" + caffeine_mg):
        // solo aporta la forma; no crea una fila duplicada
        if (it.amount == null) {
          const existing = [...found.values()].find((f) => f.code === it.code);
          if (existing) {
            if (!existing.form && it.form) existing.form = it.form;
            continue;
          }
        }
        add({ ...it, basis: itemBasis, data_source: 'other_components', serving_description: itemBasis === basis ? row.serving_size : null });
      }
      ocReviews.forEach((r) => addReview({ origin: 'other_components', ...r }));
    }

    for (const rule of PRODUCT_DESCRIPTION_RULES) {
      const m = String(p.description || '').match(rule.pattern);
      if (!m) continue;
      for (const it of rule.apply(m).items) {
        // Si otra fuente interna ya registró el ingrediente (con cualquier base), la descripción solo confirma
        const existing = [...found.values()].filter((f) => f.code === it.code);
        if (existing.length > 0) {
          if (existing.some((e) => !sameAmount(e, it) && e.unit === it.unit)) {
            addReview({
              origin: 'product_description',
              raw_text: `${it.code}: ${it.amount} ${it.unit} (descripción)`,
              suggested_code: it.code,
              reason: 'La descripción contradice otra fuente interna del producto.',
            });
          }
          continue;
        }
        add({
          ...it,
          basis: 'unspecified',
          data_source: 'product_description',
          notes: `Regla ${rule.id} sobre la descripción del producto.`,
        });
      }
    }

    // Formulaciones: el producto declara exactamente la proporción de una formulación del catálogo
    const formulations = [];
    for (const f of catalogs.formulations) {
      const matches = f.ingredients.every((fi) =>
        [...found.values()].some((it) => it.code === fi.ingredient && it.unit === 'ratio' && Math.abs(it.amount - fi.ratio_part) < 1e-6)
      );
      if (matches) {
        const src = [...found.values()].find((it) => it.code === f.ingredients[0].ingredient && it.unit === 'ratio');
        formulations.push({ product_id: p.product_id, formulation_code: f.code, data_source: src.data_source });
      }
    }

    const items = [...found.values()].map((it) => ({
      product_id: p.product_id,
      ingredient_code: it.code,
      amount: it.amount ?? null,
      unit: it.amount == null ? null : it.unit,
      basis: it.basis,
      serving_description: it.serving_description || null,
      form: it.form || null,
      notes: it.notes || null,
      data_source: it.data_source,
    }));

    result.productIngredients.push(...items);
    result.productFormulations.push(...formulations);
    result.reviews.push(...reviews);
    result.byProduct[p.product_id] = { name: p.name, items, formulations, reviews };
  }
  return result;
}
