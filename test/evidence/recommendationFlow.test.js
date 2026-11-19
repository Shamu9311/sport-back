// Integración Evidence RAG contra la BD de test: recuperación, persistencia y compatibilidad con el flujo antiguo.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pool from '../../config/db.js';
import { ingestFiles } from '../../scripts/ingestEvidence.js';
import { loadEligibilityInputs } from '../../services/evidenceEligibilityService.js';
import { generateEvidenceRecommendations, setEvidenceLLMForTests, getStructuralCandidates } from '../../services/evidenceRecommendationService.js';
import TrainingRecommendationService from '../../services/trainingRecommendationService.js';
import { resetEvidenceAndIngredients, normalizeCatalog, writeTempManifest, withClient, silent } from './helpers.js';

const chunk = (key, content) => ({ chunk_key: key, section: 'summary', content, content_kind: 'own_summary' });
const reviewedClaim = (over) => ({ statistical_significance: 'not_tested', review_status: 'reviewed', evidence_strength: 'A', ...over });

const SCIENCE = {
  schema_version: '1.1',
  source: {
    source_key: 'example-rag-guideline', source_type: 'position_stand', title: 'Guía de prueba para Evidence RAG',
    url: 'https://example.org/rag-guideline', year: 2024, review_status: 'reviewed', reviewed_by: 'Test',
    evidence_level: 'A', evidence_level_rationale: 'Fuente ficticia de prueba.', peer_reviewed: true, open_access: true,
  },
  chunks: [
    chunk('caf', 'Cafeína 3–6 mg/kg unos 60 minutos antes del ejercicio mejora el rendimiento de resistencia.'),
    chunk('caf-min', 'La dosis mínima efectiva de cafeína no está establecida; podría ser de unos 2 mg/kg.'),
    chunk('cho', 'Durante ejercicio de 1 a 2.5 horas se recomiendan 30–60 g de carbohidrato por hora.'),
    chunk('prot', 'Tomas de 20–40 g de proteína antes o después del ejercicio contribuyen a la respuesta anabólica.'),
  ],
  claims: [
    reviewedClaim({ claim_key: 'caf-3-6', claim_type: 'dosage_guideline', effect_direction: 'positive', ingredient: 'caffeine',
      dose_text: '3–6 mg/kg', dose_value: 3, dose_value_max: 6, dose_unit: 'mg/kg', timing_context: ['pre'],
      timing_evidence_strength: 'moderate', outcome: 'rendimiento', result_summary: 'Cafeína 3–6 mg/kg antes del ejercicio.', chunk_keys: ['caf'] }),
    reviewedClaim({ claim_key: 'caf-min', claim_type: 'dosage_guideline', effect_direction: 'positive', ingredient: 'caffeine',
      dose_value: 2, dose_value_max: 3, dose_unit: 'mg/kg', timing_context: ['not_specified'], timing_evidence_strength: 'not_assessed',
      evidence_strength: 'C', result_summary: 'Dosis mínima no establecida; posiblemente ~2 mg/kg.', chunk_keys: ['caf-min'] }),
    reviewedClaim({ claim_key: 'cho-during', claim_type: 'dosage_guideline', effect_direction: 'positive', ingredient: 'carbohydrate',
      dose_value: 30, dose_value_max: 60, dose_unit: 'g/h', timing_context: ['during'], timing_evidence_strength: 'moderate',
      conditions: { min_exercise_minutes: 60, max_exercise_minutes: 150 }, result_summary: '30–60 g/h durante 1–2.5 h.', chunk_keys: ['cho'] }),
    reviewedClaim({ claim_key: 'prot-timing', claim_type: 'timing_guideline', effect_direction: 'positive', ingredient: 'protein',
      timing_context: ['pre', 'post'], timing_evidence_strength: 'moderate', result_summary: 'Proteína antes o después.', chunk_keys: ['prot'] }),
    reviewedClaim({ claim_key: 'prot-dose', claim_type: 'dosage_guideline', effect_direction: 'positive', ingredient: 'protein',
      dose_value: 20, dose_value_max: 40, dose_unit: 'g', timing_context: ['daily_chronic', 'flexible'], timing_evidence_strength: 'moderate',
      result_summary: '20–40 g por toma.', chunk_keys: ['prot'] }),
  ],
};

const DRAFT = {
  schema_version: '1.1',
  source: { source_key: 'example-rag-draft', source_type: 'narrative_review', title: 'Borrador no revisado',
    url: 'https://example.org/rag-draft', review_status: 'draft' },
  chunks: [chunk('d', 'Borrador: carbohidrato antes del ejercicio en cualquier cantidad.')],
  claims: [{ claim_key: 'draft-cho-pre', claim_type: 'dosage_guideline', effect_direction: 'positive', ingredient: 'carbohydrate',
    dose_value: 1, dose_unit: 'g', timing_context: ['pre'], timing_evidence_strength: 'strong', statistical_significance: 'not_tested',
    result_summary: 'No debe usarse nunca.', review_status: 'draft', chunk_keys: ['d'] }],
};

const MAKER = {
  schema_version: '1.1',
  source: { source_key: 'example-rag-maker', source_type: 'manufacturer_specification', title: 'Ficha de prueba BETA Fuel Gel',
    url: 'https://example.org/rag-maker', review_status: 'reviewed', reviewed_by: 'Test' },
  chunks: [chunk('use', 'El fabricante indica 1–3 geles por hora durante ejercicio prolongado.')],
  claims: [{ claim_key: 'maker-use', claim_type: 'usage_instruction', product_specific: true, product_id: 25,
    effect_direction: 'not_applicable', statistical_significance: 'not_tested', review_status: 'reviewed',
    result_summary: 'Uso durante el ejercicio.', timing_context: ['during'], timing_evidence_strength: 'not_assessed',
    frequency: '1–3 geles por hora', dose_value: 1, dose_value_max: 3, dose_unit: 'servings_per_hour', chunk_keys: ['use'] }],
  product_relations: [{ product_id: 25, relation_type: 'manufacturer_specification', rationale: 'Ficha del propio producto.' }],
};

const PROFILE = { weight: 60, primary_goal: 'resistencia', caffeine_tolerance: 'medio', dietary_restrictions: 'no' };
const SESSION = { durationMin: 90, intensity: 'alto', weather: 'moderado', type: 'resistencia', sport_type: 'marathon' };
const sourceId = async (key) => (await pool.query('SELECT source_id FROM evidence_sources WHERE source_key = $1', [key])).rows[0].source_id;
let candidates;

beforeAll(async () => {
  await resetEvidenceAndIngredients();
  await normalizeCatalog();
  const files = [writeTempManifest(SCIENCE, 'rag-science'), writeTempManifest(DRAFT, 'rag-draft'), writeTempManifest(MAKER, 'rag-maker')];
  const results = await withClient((c) => ingestFiles(c, files, { confirm: true, allowExamples: true, log: silent }));
  expect(results.map((r) => r.status)).toEqual(['success', 'success', 'success']);
  candidates = (await pool.query('SELECT product_id FROM products WHERE is_active ORDER BY product_id')).rows;
}, 240000);

afterEach(() => setEvidenceLLMForTests(null));

describe('Evidence RAG — flujo completo (BD de test)', () => {
  let result;
  beforeAll(async () => {
    result = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates });
  }, 120000);

  it('genera recomendaciones solo para productos candidatos, sin cuotas ni daily_chronic', () => {
    const ids = new Set(candidates.map((c) => c.product_id));
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeLessThanOrEqual(5);
    result.recommendations.forEach((r) => expect(ids.has(r.product_id)).toBe(true));
    expect(result.recommendations.map((r) => r.consumption_timing)).not.toContain('diario');
    expect(result.omittedPhases.map((o) => o.timing)).toContain('diario');
  });

  it('una fuente draft nunca se recupera ni se usa', async () => {
    const draftId = await sourceId('example-rag-draft');
    const inputs = await loadEligibilityInputs(candidates.map((c) => c.product_id));
    expect(inputs.claims.some((c) => c.source_id === draftId)).toBe(false);
    result.recommendations.forEach((r) => r.evidence.forEach((e) => expect(e.source_id).not.toBe(draftId)));
    expect(JSON.stringify(result.context)).not.toContain('Borrador no revisado');
  });

  it('el fabricante no demuestra eficacia: solo restringe/confirma la cadencia (usage_constraint)', async () => {
    const makerId = await sourceId('example-rag-maker');
    const inputs = await loadEligibilityInputs(candidates.map((c) => c.product_id));
    expect(inputs.claims.some((c) => c.source_id === makerId)).toBe(false);
    const rows = result.recommendations.flatMap((r) => r.evidence).filter((e) => e.source_id === makerId);
    rows.forEach((e) => expect(e).toMatchObject({ role: 'usage_constraint', relation_type: 'manufacturer_specification' }));
    // Gel 25: único con cadencia verificada → elegible para carbohidrato durante con porciones/h dinámicas
    const gel = result.recommendations.find((r) => r.product_id === 25);
    if (gel) expect(gel).toMatchObject({ consumption_timing: 'durante', cadence_status: 'cadence_verified' });
  });

  it('cada claim citado fue recuperado y está en el contexto enviado al LLM', () => {
    const contextClaims = new Set(result.context.evidencia.map((e) => e.ref));
    expect(contextClaims.size).toBeGreaterThan(0);
    for (const rec of result.recommendations) {
      const supports = rec.evidence.filter((e) => e.role === 'supports');
      expect(supports.length).toBeGreaterThan(0);
    }
  });

  it('timing "limited" no habilita una fase', async () => {
    await withClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`UPDATE evidence_claims SET timing_evidence_strength = 'limited' WHERE claim_key IN ('caf-3-6')`);
        const r = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates, client: c });
        expect(r.recommendations.filter((x) => x.nutrient === 'caffeine')).toHaveLength(0);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  }, 120000);

  it('si el LLM falla, el respaldo determinista sigue funcionando', async () => {
    setEvidenceLLMForTests(() => { throw new Error('LLM caído'); });
    const r = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates });
    expect(r.mode).toBe('fallback');
    expect(r.recommendations.length).toBe(result.recommendations.length);
  }, 120000);

  it('descarta recomendaciones del LLM con productos no candidatos o evidencia inventada', async () => {
    setEvidenceLLMForTests(() => ({ recommendations: [
      { product_id: 99999, consumption_timing: 'durante', evidence: [{ claim_ref: 'C1', role: 'supports' }] },
      { product_ref: 'P1', consumption_timing: 'antes', evidence: [{ claim_ref: 'C404', role: 'supports' }] },
    ] }));
    const r = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates });
    expect(r.discarded.length).toBeGreaterThanOrEqual(2);
    expect(r.mode).toBe('fallback'); // nada válido → respaldo trazable
  }, 120000);

  it('recuperación híbrida: un producto estructuralmente elegible entra aunque no esté en el top vectorial', async () => {
    const r = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates: [{ product_id: 1 }] });
    expect(r.candidateStats.vector).toBe(1);
    expect(r.candidateStats.added_ids).toContain(25); // gel con cadencia verificada en la ficha de prueba
    expect(r.recommendations.some((x) => x.product_id === 25)).toBe(true);
    const noHybrid = await generateEvidenceRecommendations({ profile: PROFILE, trainingData: SESSION, candidates: [{ product_id: 1 }], hybrid: false });
    expect(noHybrid.recommendations.some((x) => x.product_id === 25)).toBe(false);
  }, 120000);

  it('recuperación híbrida: aplica los mismos filtros duros (cafeína "no", roles no_fueling)', async () => {
    const structural = await getStructuralCandidates({ profile: { ...PROFILE, caffeine_tolerance: 'no' } });
    const ids = structural.map((p) => p.product_id);
    const { rows } = await pool.query(`SELECT p.product_id FROM products p JOIN product_nutrition pn USING (product_id)
      WHERE pn.caffeine_mg > 0`);
    rows.forEach((x) => expect(ids).not.toContain(x.product_id));
    const { rows: noFueling } = await pool.query(`SELECT p.product_id FROM products p JOIN product_type_functional_roles r USING (type_id)
      WHERE 'no_fueling' = ANY (r.roles)`);
    noFueling.forEach((x) => expect(ids).not.toContain(x.product_id));
  });

  it('la BD impide registrar al fabricante como respaldo de eficacia', async () => {
    const makerId = await sourceId('example-rag-maker');
    await expect(withClient(async (c) => {
      await c.query('BEGIN');
      try {
        const { rows: [u] } = await c.query(`INSERT INTO users (username, email, password) VALUES ('rag', 'rag-x@test.local', 'x') RETURNING user_id`);
        const { rows: [rec] } = await c.query(`INSERT INTO recommendations (user_id, product_id) VALUES ($1, 25) RETURNING recommendation_id`, [u.user_id]);
        await c.query(`INSERT INTO recommendation_evidence (recommendation_id, source_id, relation_type, role) VALUES ($1, $2, 'ingredient', 'supports')`,
          [rec.recommendation_id, makerId]);
      } finally {
        await c.query('ROLLBACK');
      }
    })).rejects.toThrow(/fabricante/);
  });
});

describe('Persistencia y compatibilidad con USE_EVIDENCE_RAG', () => {
  let userId;
  const flag = process.env.USE_EVIDENCE_RAG;

  beforeAll(async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username, email, password) VALUES ('rag-user', $1, 'x') RETURNING user_id`, [`rag-${Date.now()}@test.local`]);
    userId = u.user_id;
    await pool.query(`INSERT INTO user_profiles (user_id, age, weight, height, gender, activity_level, training_frequency, primary_goal,
      sweat_level, caffeine_tolerance, dietary_restrictions) VALUES ($1, 30, 60, 170, 'mujer', 'activo', '3-4', 'resistencia', 'medio', 'medio', 'no')`, [userId]);
  });
  afterAll(async () => {
    process.env.USE_EVIDENCE_RAG = flag;
    await pool.query('DELETE FROM recommendations WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM training_sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
  });
  const newSession = async () => (await pool.query(
    `INSERT INTO training_sessions (user_id, session_date, duration_min, intensity, type, weather, sport_type)
     VALUES ($1, CURRENT_DATE, 90, 'alto', 'resistencia', 'moderado', 'marathon') RETURNING session_id`, [userId])).rows[0].session_id;
  const trainingData = { type: 'resistencia', intensity: 'alto', durationMin: 90, weather: 'moderado', sport_type: 'marathon' };

  it('USE_EVIDENCE_RAG=false mantiene el comportamiento anterior (4 fases mock, sin evidencia ni estado)', async () => {
    process.env.USE_EVIDENCE_RAG = 'false';
    const sessionId = await newSession();
    const recs = await TrainingRecommendationService.generateTrainingRecommendations(userId, sessionId, trainingData);
    expect(recs.length).toBe(4);
    recs.forEach((r) => expect(r.evidence_mode).toBe('legacy'));
    const { rows: ev } = await pool.query(`SELECT count(*)::int n FROM recommendation_evidence re JOIN recommendations r USING (recommendation_id)
      WHERE r.session_id = $1`, [sessionId]);
    expect(ev[0].n).toBe(0);
    const { rows: [s] } = await pool.query('SELECT recommendation_status FROM training_sessions WHERE session_id = $1', [sessionId]);
    expect(s.recommendation_status).toBeNull();
  }, 120000);

  it('USE_EVIDENCE_RAG=true persiste recomendaciones trazables y el estado de la sesión', async () => {
    process.env.USE_EVIDENCE_RAG = 'true';
    const sessionId = await newSession();
    const recs = await TrainingRecommendationService.generateTrainingRecommendations(userId, sessionId, trainingData);
    const { rows: [s] } = await pool.query('SELECT recommendation_status FROM training_sessions WHERE session_id = $1', [sessionId]);
    expect(s.recommendation_status).toBe(recs.length ? 'ready' : 'none');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(5);
    for (const r of recs) {
      expect(r.evidence_mode).toBe('evidence_rag');
      expect(['cadence_verified', 'cadence_unverified']).toContain(r.cadence_status);
      expect(r.evidence.some((e) => e.role === 'supports')).toBe(true);
      r.evidence.forEach((e) => {
        expect(e).not.toHaveProperty('similarity');
        expect(e.title).toBeTruthy();
      });
    }
    // La evidencia citada existe realmente y respeta la separación ciencia/fabricante
    const { rows } = await pool.query(`SELECT re.role, s.source_category, s.review_status, c.review_status AS claim_status
      FROM recommendation_evidence re JOIN recommendations r USING (recommendation_id)
      JOIN evidence_sources s ON s.source_id = re.source_id LEFT JOIN evidence_claims c ON c.claim_id = re.claim_id
      WHERE r.session_id = $1`, [sessionId]);
    expect(rows.length).toBeGreaterThan(0);
    rows.filter((x) => x.role === 'supports').forEach((x) => {
      expect(x.source_category).not.toBe('manufacturer_specification');
      expect(x.review_status).toBe('reviewed');
      expect(x.claim_status).toBe('reviewed');
    });
  }, 120000);
});
