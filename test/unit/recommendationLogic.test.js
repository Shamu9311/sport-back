import { describe, it, expect } from 'vitest';
import {
  sanitizeLLMRecommendations,
  completeMissingTimings,
  getFallbackRecommendations,
} from '../../services/llmService.js';
import { balanceByUsageContext } from '../../services/retrievalService.js';
import TrainingSession from '../../models/trainingSessionModel.js';

const profile = { user_id: 1, primary_goal: 'resistencia', caffeine_tolerance: 'medio', dietary_restrictions: 'no' };

const product = (id, usage_context, extra = {}) => ({
  product_id: id,
  name: `Producto ${id}`,
  category: 'energia',
  usage_context,
  attributes: [],
  carbs_g: 20,
  protein_g: 0,
  energy_kcal: 100,
  caffeine_mg: 0,
  ...extra,
});

const candidates = [
  product(1, 'pre entrenamiento'),
  product(2, 'durante entrenamiento'),
  product(3, 'post entrenamiento', { category: 'recuperacion', protein_g: 20 }),
  product(4, 'diario', { category: 'vitaminas' }),
  product(5, 'pre entrenamiento', { caffeine_mg: 200 }),
];

describe('Validación de la respuesta del LLM (A2)', () => {
  it('descarta solo los ítems inválidos y conserva los válidos', () => {
    const { valid, discarded } = sanitizeLLMRecommendations(
      [
        { product_id: 1, consumption_timing: 'antes' },
        { product_id: '2', consumption_timing: 'durante' },
        { product_id: null, consumption_timing: 'diario' },
        { product_id: 99, consumption_timing: 'despues' },
        { product_id: 3, consumption_timing: 'antes' },
      ],
      candidates
    );
    expect(valid.map((r) => [r.product_id, r.consumption_timing])).toEqual([
      [1, 'antes'],
      [2, 'durante'],
    ]);
    expect(discarded).toHaveLength(3);
  });

  it('completa la fase faltante solo con un producto de esa fase', () => {
    const valid = [
      { product_id: 1, consumption_timing: 'antes' },
      { product_id: 2, consumption_timing: 'durante' },
      { product_id: 3, consumption_timing: 'despues' },
    ];
    const result = completeMissingTimings(valid, profile, candidates);
    expect(result.map((r) => r.consumption_timing)).toEqual(['antes', 'durante', 'despues', 'diario']);
    expect(result.find((r) => r.consumption_timing === 'diario').product_id).toBe(4);
  });
});

describe('Sistema de reglas (A4)', () => {
  it('no asigna un producto a una fase que no le corresponde', () => {
    const onlyEnergy = [product(10, 'pre entrenamiento', { caffeine_mg: 200 }), product(11, 'durante entrenamiento')];
    const { recommendations } = getFallbackRecommendations(profile, onlyEnergy, 4);
    const timings = recommendations.map((r) => r.consumption_timing);
    expect(timings).toEqual(['antes', 'durante']);
    expect(timings).not.toContain('diario');
  });

  it('excluye productos con cafeína si la tolerancia es "no"', () => {
    const { recommendations } = getFallbackRecommendations(
      { ...profile, caffeine_tolerance: 'no' },
      [product(20, 'pre entrenamiento', { caffeine_mg: 100 })],
      4
    );
    expect(recommendations).toHaveLength(0);
  });
});

describe('Cobertura de candidatos por momento (A3)', () => {
  it('garantiza productos de cada usage_context aunque el ranking favorezca uno', () => {
    const ranked = [
      ...Array.from({ length: 25 }, (_, i) => product(100 + i, 'pre entrenamiento')),
      product(200, 'post entrenamiento'),
      product(201, 'diario'),
      product(202, 'durante entrenamiento'),
    ];
    const balanced = balanceByUsageContext(ranked, 20, 3);
    expect(balanced).toHaveLength(20);
    const contexts = new Set(balanced.map((p) => p.usage_context));
    expect(contexts).toEqual(new Set(['pre entrenamiento', 'post entrenamiento', 'diario', 'durante entrenamiento']));
    // Conserva el orden del ranking original
    expect(balanced[0].product_id).toBe(100);
  });
});

describe('Edición de entrenamientos (A5, A6)', () => {
  it('acepta valores ya normalizados de clima e intensidad', () => {
    expect(TrainingSession.mapWeather('calido')).toBe('calido');
    expect(TrainingSession.mapWeather('soleado')).toBe('calido');
    expect(TrainingSession.mapIntensity('alto')).toBe('alto');
    expect(TrainingSession.mapIntensity('alta')).toBe('alto');
  });

  it('detecta cambios reales y no solo claves presentes', () => {
    const current = { duration_min: 45, intensity: 'medio', type: 'cardio', sport_type: '10K', weather: 'calido' };
    const samePatch = { duration_min: 45, intensity: 'media', type: 'cardio', sport_type: '10K', weather: 'soleado' };
    expect(TrainingSession.changedRecommendationFields(current, samePatch)).toEqual([]);
    expect(TrainingSession.changedRecommendationFields(current, { ...samePatch, duration_min: 90 })).toEqual([
      'duration_min',
    ]);
    expect(TrainingSession.changedRecommendationFields(current, { notes: 'x' })).toEqual([]);
  });
});
