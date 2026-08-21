import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'test-results');

dotenv.config({ path: path.join(ROOT, '.env.test'), override: true });

const useRealApis = process.argv.includes('--real');
const runs = parseInt(process.env.PERF_RUNS || '20', 10);
const port = process.env.PERF_PORT || '5100';
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values) {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // server still booting
    }
    await sleep(500);
  }
  throw new Error('Timeout esperando health del servidor de rendimiento');
}

async function api(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function registerLoginProfile() {
  const suffix = Date.now();
  const email = `perf_${suffix}@test.local`;
  const password = 'PerfTest123!';

  await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `perf_${suffix}`, email, password }),
  });

  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const token = login.body.token;
  const userId = login.body.user.id;

  await api(`/api/profile/${userId}/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      age: 28,
      weight: 72,
      height: 175,
      gender: 'hombre',
      activity_level: 'moderado',
      training_frequency: '3-4',
      primary_goal: 'mejor rendimiento',
      sweat_level: 'medio',
      caffeine_tolerance: 'medio',
      dietary_restrictions: 'no',
    }),
  });

  return { token, userId };
}

async function runSingleFlow(token, userId) {
  const start = Date.now();

  const created = await api('/api/training', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId,
      session_date: '2026-08-21',
      start_time: '08:00:00',
      duration_min: 60,
      intensity: 'media',
      type: 'entrenamiento',
      sport_type: 'running',
      weather: 'templado',
      notes: 'performance test',
    }),
  });

  if (created.status !== 201) {
    throw new Error(`POST /api/training falló: ${created.status}`);
  }

  const sessionId = created.body.data.session_id;
  let found = false;

  for (let i = 0; i < 40; i += 1) {
    const recs = await api(`/api/training/${sessionId}/recommendations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (recs.status === 200 && Array.isArray(recs.body?.data) && recs.body.data.length > 0) {
      found = true;
      break;
    }
    await sleep(200);
  }

  if (!found) {
    throw new Error(`No se obtuvieron recomendaciones para sesión ${sessionId}`);
  }

  return Date.now() - start;
}

async function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const serverEnv = {
    ...process.env,
    PORT: port,
    DB_NAME: process.env.DB_NAME || 'sport_test',
    MOCK_LLM: useRealApis ? 'false' : 'true',
    MOCK_EMBEDDINGS: useRealApis ? 'false' : 'true',
    MOCK_LLM_DELAY_MS: useRealApis ? '0' : process.env.MOCK_LLM_DELAY_MS || '100',
    USE_VECTOR_SEARCH: useRealApis ? process.env.USE_VECTOR_SEARCH || 'true' : 'true',
    NODE_ENV: 'test',
  };

  if (useRealApis) {
    console.warn('⚠️ Modalidad REAL: se usarán APIs externas si están configuradas en el entorno.');
  } else {
    console.log('Ejecutando prueba de rendimiento con mocks (20 corridas secuenciales)...');
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: serverEnv,
    stdio: 'inherit',
  });

  const durations = [];
  const errors = [];

  try {
    await waitForHealth();
    const { token, userId } = await registerLoginProfile();

    for (let i = 0; i < runs; i += 1) {
      try {
        const ms = await runSingleFlow(token, userId);
        durations.push(ms);
        console.log(`Run ${i + 1}/${runs}: ${ms} ms`);
      } catch (error) {
        errors.push({ run: i + 1, message: error.message });
        console.error(`Run ${i + 1} error:`, error.message);
      }
    }
  } finally {
    server.kill('SIGTERM');
  }

  const summary = {
    mode: useRealApis ? 'real' : 'mock',
    runs,
    successfulRuns: durations.length,
    failedRuns: errors.length,
    minMs: durations.length ? Math.min(...durations) : null,
    maxMs: durations.length ? Math.max(...durations) : null,
    avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    medianMs: durations.length ? median(durations) : null,
    stdDevMs: durations.length ? stdDev(durations) : null,
    durationsMs: durations,
    errors,
    generatedAt: new Date().toISOString(),
  };

  const jsonPath = path.join(RESULTS_DIR, 'performance-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const csvLines = ['run,duration_ms,status', ...durations.map((d, i) => `${i + 1},${d},ok`)];
  errors.forEach((e) => csvLines.push(`${e.run},,error:${e.message.replace(/,/g, ';')}`));
  fs.writeFileSync(path.join(RESULTS_DIR, 'performance-results.csv'), csvLines.join('\n'));

  console.log('\nResumen:', summary);
  console.log(`Resultados guardados en ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
