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

// Convertir texto a vectores usando Gemini
export async function generateEmbedding(text) {
  if (process.env.MOCK_EMBEDDINGS === 'true') {
    return generateDeterministicEmbedding(text);
  }

  if (!geminiClient) {
    throw new Error('Gemini client not initialized. Check GEMINI_API_KEY in .env');
  }
  
  try {
    // Usar modelo de embeddings de Gemini
    const model = geminiClient.getGenerativeModel({ 
      model: "text-embedding-004"  // Modelo de embeddings de Gemini (768 dimensiones)
    });
    
    const result = await model.embedContent(text.substring(0, 10000));
    
    return result.embedding.values;  // Array de floats (768 dimensiones)
    
  } catch (error) {
    console.error('Error generating embedding with Gemini:', error);
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
  
  return await generateEmbedding(profileText);
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
  `.trim();
  
  return await generateEmbedding(productText);
}