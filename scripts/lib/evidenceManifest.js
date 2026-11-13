// scripts/lib/evidenceManifest.js — Validación de manifiestos de evidencia (JSON Schema + reglas de negocio).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { contentHash } from './chunker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(__dirname, '../../data/evidence/schema/evidence-manifest.v1.schema.json');

let compiled = null;
function getValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
  }
  return compiled;
}

export class ManifestValidationError extends Error {
  constructor(errors, warnings = []) {
    super(`Manifiesto inválido:\n - ${errors.join('\n - ')}`);
    this.errors = errors;
    this.warnings = warnings;
  }
}

export function readManifest(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return {
    manifest: JSON.parse(raw),
    sha256: crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
  };
}

/** Validación estructural (JSON Schema v1). */
export function validateSchema(manifest) {
  const validate = getValidator();
  if (validate(manifest)) return [];
  return validate.errors
    .filter((e) => e.keyword !== 'if') // el error útil es el de la rama "then/else"
    .map((e) => `schema${e.instancePath || ''}: ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);
}

const MANUFACTURER_CLAIM_TYPES = new Set(['composition', 'usage_instruction']);
const GUIDELINE_TYPES = new Set(['consensus', 'position_stand', 'guideline', 'official_framework']);

/**
 * Reglas de negocio y referencias.
 * @param {object} manifest
 * @param {{ ingredientCodes?: Set<string>, formulationCodes?: Set<string>, productIds?: Set<number>, categoryIds?: Set<number> }} ctx
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateBusinessRules(manifest, ctx = {}) {
  const errors = [];
  const warnings = [];
  const source = manifest.source || {};
  const chunks = manifest.chunks || [];
  const claims = manifest.claims || [];
  const relations = manifest.product_relations || [];
  const productIngredients = manifest.product_ingredients || [];
  const isManufacturer = source.source_type === 'manufacturer_specification';

  const dup = (list, keyFn, label) => {
    const seen = new Set();
    for (const item of list) {
      const k = keyFn(item);
      if (seen.has(k)) errors.push(`${label} duplicado: ${k}`);
      seen.add(k);
    }
  };
  dup(chunks, (c) => c.chunk_key, 'chunk_key');
  dup(chunks, (c) => contentHash(c.content), 'contenido de chunk (content_hash)');
  dup(claims, (c) => c.claim_key, 'claim_key');

  const chunkKeys = new Set(chunks.map((c) => c.chunk_key));
  const claimByKey = new Map(claims.map((c) => [c.claim_key, c]));
  const checkProduct = (id, where) => {
    if (ctx.productIds && !ctx.productIds.has(id)) errors.push(`${where}: producto inexistente (${id})`);
  };
  const checkIngredient = (code, where) => {
    if (ctx.ingredientCodes && !ctx.ingredientCodes.has(code)) errors.push(`${where}: ingrediente inexistente (${code})`);
  };
  const checkFormulation = (code, where) => {
    if (ctx.formulationCodes && !ctx.formulationCodes.has(code)) errors.push(`${where}: formulación inexistente (${code})`);
  };

  if (!source.title || !String(source.title).trim()) errors.push('source sin título');
  if (source.review_status === 'reviewed' && !source.reviewed_by) warnings.push('source revisada sin reviewed_by');
  if (!isManufacturer && source.peer_reviewed === undefined && !GUIDELINE_TYPES.has(source.source_type)) {
    warnings.push('source científica sin peer_reviewed declarado');
  }
  if (source.open_access === false && chunks.some((c) => c.content_kind === 'verbatim' && c.section !== 'abstract')) {
    errors.push('fuente sin licencia abierta: solo abstract, extractos breves o resúmenes propios (no texto literal completo)');
  }

  for (const claim of claims) {
    const where = `claim ${claim.claim_key}`;
    (claim.chunk_keys || []).forEach((k) => {
      if (!chunkKeys.has(k)) errors.push(`${where}: chunk_key inexistente (${k})`);
    });
    if (claim.ingredient) checkIngredient(claim.ingredient, where);
    if (claim.formulation) checkFormulation(claim.formulation, where);
    if (claim.product_id) checkProduct(claim.product_id, where);

    if (isManufacturer && !MANUFACTURER_CLAIM_TYPES.has(claim.claim_type)) {
      errors.push(`${where}: una especificación del fabricante solo admite claims composition/usage_instruction (recibido ${claim.claim_type})`);
    }
    if (isManufacturer && claim.sample_size) errors.push(`${where}: sample_size no aplica a una especificación del fabricante`);

    const timing = claim.timing_context || ['not_specified'];
    if (timing.includes('not_specified') && timing.length > 1) {
      errors.push(`${where}: timing_context incoherente ("not_specified" no se combina con otros momentos)`);
    }
    if (claim.sample_size && GUIDELINE_TYPES.has(source.source_type)) {
      warnings.push(`${where}: sample_size en una guía/consenso; verificar que provenga de la fuente`);
    }
    if (['efficacy', 'safety'].includes(claim.claim_type) && !claim.sample_size && !GUIDELINE_TYPES.has(source.source_type)
        && !['meta_analysis', 'systematic_review'].includes(source.source_type)) {
      warnings.push(`${where}: sin sample_size (permitido si la publicación no lo informa)`);
    }
    if (timing.includes('daily_chronic') && !claim.frequency && !claim.duration_protocol) {
      warnings.push(`${where}: daily_chronic sin frequency ni duration_protocol`);
    }
    if (claim.review_status === 'reviewed' && source.review_status !== 'reviewed') {
      warnings.push(`${where}: claim revisado en una fuente que no está revisada (no será recuperable)`);
    }
  }

  for (const rel of relations) {
    const where = `relación producto ${rel.product_id}/${rel.relation_type}`;
    checkProduct(rel.product_id, where);
    if (rel.ingredient) checkIngredient(rel.ingredient, where);
    if (rel.formulation) checkFormulation(rel.formulation, where);
    if (rel.category_id && ctx.categoryIds && !ctx.categoryIds.has(rel.category_id)) {
      errors.push(`${where}: categoría inexistente (${rel.category_id})`);
    }
    const claim = rel.claim_key ? claimByKey.get(rel.claim_key) : null;
    if (rel.claim_key && !claim) errors.push(`${where}: claim_key inexistente (${rel.claim_key})`);

    if (rel.relation_type === 'direct_product' && (!claim?.product_specific || claim.product_id !== rel.product_id)) {
      errors.push(`${where}: direct_product exige un claim product_specific del mismo producto`);
    }
    if (rel.relation_type === 'direct_product' && isManufacturer) {
      errors.push(`${where}: una fuente del fabricante se relaciona como manufacturer_specification`);
    }
    if (rel.relation_type === 'manufacturer_specification' && !isManufacturer) {
      errors.push(`${where}: manufacturer_specification exige una fuente del fabricante`);
    }
    if (rel.relation_type === 'ingredient' && claim && claim.ingredient !== rel.ingredient) {
      errors.push(`${where}: el ingrediente no coincide con el del claim`);
    }
    if (rel.relation_type === 'formulation' && claim && claim.formulation !== rel.formulation) {
      errors.push(`${where}: la formulación no coincide con la del claim`);
    }
  }

  if (productIngredients.length && !isManufacturer) {
    errors.push('product_ingredients solo se admite en fuentes manufacturer_specification');
  }
  const manufacturerProducts = new Set(claims.filter((c) => c.product_specific).map((c) => c.product_id));
  for (const pi of productIngredients) {
    const where = `product_ingredients ${pi.product_id}/${pi.ingredient}`;
    checkProduct(pi.product_id, where);
    checkIngredient(pi.ingredient, where);
    if (!manufacturerProducts.has(pi.product_id)) {
      errors.push(`${where}: el producto debe ser objeto de un claim product_specific de esta ficha`);
    }
  }

  return { errors, warnings };
}

/** Validación completa: schema + reglas. Lanza ManifestValidationError si hay errores. */
export function validateManifest(manifest, ctx = {}) {
  const schemaErrors = validateSchema(manifest);
  if (schemaErrors.length) throw new ManifestValidationError(schemaErrors);
  const { errors, warnings } = validateBusinessRules(manifest, ctx);
  if (errors.length) throw new ManifestValidationError(errors, warnings);
  return { warnings };
}
