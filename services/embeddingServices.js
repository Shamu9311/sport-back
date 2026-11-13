import { GoogleGenerativeAI } from "@google/generative-ai";
import 'dotenv/config';

// Inicializar cliente de Gemini
let geminiClient = null;

const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '';

if (hasGeminiKey) {
  try {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ Gemini client initialized for embeddings');
  } catch (error) {
    console.error('❌ Error initializing Gemini client for embeddings:', error);
  }
} else {
  console.warn('⚠️ GEMINI_API_KEY is missing. Embeddings will not work.');
}

function generateDeterministicEmbedding(text, dimensions = 768) {
  const source = String(text || 'default');
  const vector = new Array(dimensions);
  let seed = 0;
  for (let i = 0; i < source.length; i += 1) {
    seed = (seed * 31 + source.charCodeAt(i)) % 2147483647;
  }
  for (let i = 0; i < dimensions; i += 1) {
    seed = (seed * 1103515245 + 12345 + i) % 2147483647;
    vector[i] = ((seed % 2000) - 1000) / 1000;
  }
  return vector;
}

// text-embedding-004 fue retirado de la API de Gemini (404). gemini-embedding-001 permite fijar
// outputDimensionality=768, compatible con las columnas vector(768).
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;
export const TASK_TYPES = { document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY' };

// Convertir texto a vectores usando Gemini
// taskType: RETRIEVAL_DOCUMENT para lo que se indexa (productos) y RETRIEVAL_QUERY para la consulta (perfil).
export async function generateEmbedding(text, { taskType = TASK_TYPES.document } = {}) {
  if (process.env.MOCK_EMBEDDINGS === 'true') {
    return generateDeterministicEmbedding(text);
  }

  if (!geminiClient) {
    throw new Error('Gemini client not initialized. Check GEMINI_API_KEY in .env');
  }

  try {
    const model = geminiClient.getGenerativeModel({ model: EMBEDDING_MODEL });

    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text: String(text || '').substring(0, 10000) }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    });

    const values = result.embedding.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding con dimensión inesperada (${values?.length}); se esperaban ${EMBEDDING_DIMENSIONS}.`);
    }
    return values;

  } catch (error) {
    console.error('Error generating embedding with Gemini:', error.message);
    throw error;
  }
}

// Generar embedding para perfil de usuario
export async function generateUserProfileEmbedding(userProfile) {
  const profileText = `
    Objetivo: ${userProfile.primary_goal || 'general'}
    Tipo entrenamiento: ${userProfile.training_type || 'general'}
    Intensidad: ${userProfile.intensity || 'media'}
    Duración: ${userProfile.duration || 0} minutos
    Nivel actividad: ${userProfile.activity_level || 'moderado'}
    Frecuencia: ${userProfile.training_frequency || '3-4'} veces/semana
    Restricciones dietéticas: ${userProfile.dietary_restrictions || 'ninguna'}
    Tolerancia cafeína: ${userProfile.caffeine_tolerance || 'media'}
    Nivel sudoración: ${userProfile.sweat_level || 'medio'}
  `.trim();

  return await generateEmbedding(profileText, { taskType: TASK_TYPES.query });
}

// Generar embedding para producto
export async function generateProductEmbedding(product) {
  const productText = `
    Nombre: ${product.name || product.product_name || 'Sin nombre'}
    Categoría: ${product.category_name || product.category || 'general'}
    Tipo: ${product.type_name || product.type || 'suplemento'}
    Descripción: ${product.description || product.product_description || ''}
    Recomendación de uso: ${product.usage_recommendation || ''}
    Proteína: ${product.protein_g || 0}g
    Carbohidratos: ${product.carbs_g || 0}g
    Calorías: ${product.energy_kcal || 0} kcal
    Cafeína: ${product.caffeine_mg || 0}mg
    Atributos: ${product.attributes || 'ninguno'}
    Momento de uso: ${product.usage_context || 'general'}
    Componentes: ${product.other_components && product.other_components !== 'None' ? product.other_components : 'no especificados'}
  `.trim();

  return await generateEmbedding(productText, { taskType: TASK_TYPES.document });
}