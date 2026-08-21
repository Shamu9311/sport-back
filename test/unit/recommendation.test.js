import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cosineSimilarity } from '../../services/vectorSearchService.js';
import { generateEmbedding, generateUserProfileEmbedding } from '../../services/embeddingServices.js';
import { getFallbackRecommendations } from '../../services/llmService.js';
import { getRecommendationsFromLLM } from '../../services/llmService.js';

describe('Sistema de recomendación - unitarias', () => {
  beforeEach(() => {
    process.env.MOCK_LLM = 'true';
    process.env.MOCK_LLM_DELAY_MS = '0';
    process.env.MOCK_EMBEDDINGS = 'true';
  });

  const userProfile = {
    user_id: 1,
    primary_goal: 'mejor rendimiento',
    caffeine_tolerance: 'medio',
    dietary_restrictions: 'no',
    age: 30,
    weight: 70,
    height: 170,
    activity_level: 'moderado',
  };

  const candidateProducts = [
    {
      product_id: 1,
      name: 'Energy Gel',
      category: 'energia',
      type: 'gel',
      usage_context: 'durante entrenamiento',
      description: 'Gel energético',
      usage_recommendation: 'Durante',
      attributes: ['alto en carbohidrato'],
      protein_g: 0,
      carbs_g: 25,
      energy_kcal: 100,
      caffeine_mg: 0,
    },
    {
      product_id: 2,
      name: 'Recovery',
      category: 'recuperacion',
      type: 'polvo',
      usage_context: 'post entrenamiento',
      description: 'Recuperación',
      usage_recommendation: 'Después',
      attributes: ['alto en proteina'],
      protein_g: 20,
      carbs_g: 30,
      energy_kcal: 220,
      caffeine_mg: 0,
    },
    {
      product_id: 3,
      name: 'Pre Energy',
      category: 'energia',
      type: 'bebida',
      usage_context: 'pre entrenamiento',
      description: 'Pre',
      usage_recommendation: 'Antes',
      attributes: [],
      protein_g: 0,
      carbs_g: 40,
      energy_kcal: 160,
      caffeine_mg: 75,
    },
    {
      product_id: 4,
      name: 'Daily Vitamin',
      category: 'vitaminas',
      type: 'pastilla',
      usage_context: 'diario',
      description: 'Vitaminas',
      usage_recommendation: 'Diario',
      attributes: [],
      protein_g: 0,
      carbs_g: 0,
      energy_kcal: 10,
      caffeine_mg: 0,
    },
  ];

  it('embedding mock tiene 768 dimensiones', async () => {
    const embedding = await generateEmbedding('texto de prueba');
    expect(embedding).toHaveLength(768);
  });

  it('texto de perfil para embedding incluye objetivo y restricciones', async () => {
    const embedding = await generateUserProfileEmbedding({
      primary_goal: 'resistencia',
      dietary_restrictions: 'vegano',
      caffeine_tolerance: 'bajo',
      activity_level: 'activo',
      training_frequency: '5+',
      intensity: 'alta',
      duration: 90,
      training_type: 'competencia',
    });
    expect(embedding).toHaveLength(768);
  });

  it('similitud coseno entre vectores idénticos es 1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('similitud coseno ordena candidatos correctamente', () => {
    const base = [1, 0, 0];
    const near = [0.9, 0.1, 0];
    const far = [0, 1, 0];
    expect(cosineSimilarity(base, near)).toBeGreaterThan(cosineSimilarity(base, far));
  });

  it('MOCK LLM devuelve exactamente 4 recomendaciones', async () => {
    const result = await getRecommendationsFromLLM(userProfile, candidateProducts, 4);
    expect(result.recommendations).toHaveLength(4);
    expect(result.promptUsed).toBe('MOCK_LLM');
  });

  it('fallback por reglas devuelve 4 recomendaciones cuando LLM no está disponible', () => {
    const result = getFallbackRecommendations(userProfile, candidateProducts, 4);
    expect(result.recommendations).toHaveLength(4);
    expect(result.promptUsed).toMatch(/respaldo/i);
  });

  it('fallback excluye productos incompatibles con restricción vegana', () => {
    const veganProfile = { ...userProfile, dietary_restrictions: 'vegano' };
    const mixedProducts = [
      ...candidateProducts,
      {
        product_id: 99,
        name: 'No Vegan',
        category: 'energia',
        attributes: ['contiene lactosa'],
        protein_g: 10,
        carbs_g: 10,
        energy_kcal: 100,
        caffeine_mg: 0,
      },
    ];
    const result = getFallbackRecommendations(veganProfile, mixedProducts, 4);
    const ids = result.recommendations.map((r) => r.product_id);
    expect(ids).not.toContain(99);
  });
});
