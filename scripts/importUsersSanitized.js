// scripts/importUsersSanitized.js — OPCIONAL. Importa el historial de usuarios del dump ANONIMIZADO.
//
// El dump contiene datos personales reales (correos, hashes de contraseña, edad/peso/altura, notas).
// Este script NO copia ninguno de esos datos tal cual:
//   - email     -> user{N}@example.invalid          - username -> usuario_{N}
//   - password  -> hash bcrypt de un valor aleatorio descartado (nadie puede iniciar sesión)
//   - edad      -> redondeada a la década           - peso/altura -> redondeados a múltiplos de 5
//   - notas libres de sesiones y feedback -> NULL
//   - gender    -> NULL
// Se conservan los campos que usa el RAG (objetivo, cafeína, dieta...) y las relaciones
// (sesiones, recomendaciones, feedback) para análisis de la tesis. Nunca imprime valores originales.
//
// Uso:
//   node scripts/importUsersSanitized.js --dry-run
//   node scripts/importUsersSanitized.js --confirm
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { readDump, DEFAULT_DUMP_PATH } from './lib/mariadbDump.js';
import { upsertRows, syncIdentity } from './lib/catalogImport.js';
import { connect, flagValue, hasFlag } from './lib/cli.js';

const roundTo = (value, step) => (value === null || value === undefined ? null : Math.round(Number(value) / step) * step);
const toBool = (v) => (v === null || v === undefined ? null : Number(v) !== 0);
const normalizeFrequency = (v) => (v === 'ocacional' ? 'ocasional' : v || null);
const blankToNull = (v) => (v === '' ? null : v);

export function sanitizeDump(dump) {
  const users = dump.users?.rows || [];
  const unusablePassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

  const sanitizedUsers = users.map((u) => ({
    user_id: u.user_id,
    username: `usuario_${u.user_id}`,
    email: `user${u.user_id}@example.invalid`,
    password: unusablePassword,
    created_at: u.created_at,
  }));
  const userIds = new Set(sanitizedUsers.map((u) => u.user_id));
  const keep = (row) => userIds.has(row.user_id);

  const profiles = (dump.user_profiles?.rows || []).filter(keep).map((p) => ({
    profile_id: p.profile_id,
    user_id: p.user_id,
    age: p.age === null ? null : Math.max(roundTo(p.age, 10), 10),
    weight: roundTo(p.weight, 5),
    height: roundTo(p.height, 5),
    gender: null,
    activity_level: blankToNull(p.activity_level),
    training_frequency: normalizeFrequency(blankToNull(p.training_frequency)),
    primary_goal: blankToNull(p.primary_goal),
    sweat_level: blankToNull(p.sweat_level),
    caffeine_tolerance: blankToNull(p.caffeine_tolerance),
    dietary_restrictions: blankToNull(p.dietary_restrictions) || 'no',
  }));

  const sessions = (dump.training_sessions?.rows || []).filter(keep).map((s) => ({
    ...s,
    intensity: blankToNull(s.intensity),
    type: blankToNull(s.type),
    weather: blankToNull(s.weather),
    sport_type: blankToNull(s.sport_type),
    notes: null,
  }));
  const sessionIds = new Set(sessions.map((s) => s.session_id));

  const recommendations = (dump.recommendations?.rows || []).filter(keep).map((r) => ({
    ...r,
    session_id: r.session_id !== null && sessionIds.has(r.session_id) ? r.session_id : null,
    feedback: blankToNull(r.feedback),
    consumption_timing: blankToNull(r.consumption_timing),
  }));

  const feedback = (dump.user_product_feedback?.rows || []).filter(keep).map((f) => ({ ...f, notes: null }));

  const notificationPreferences = (dump.notification_preferences?.rows || []).filter(keep).map((n) => ({
    ...n,
    consumption_reminders: toBool(n.consumption_reminders),
    training_alerts: toBool(n.training_alerts),
  }));

  return { sanitizedUsers, profiles, sessions, recommendations, feedback, notificationPreferences };
}

async function main() {
  const dumpPath = flagValue('dump', DEFAULT_DUMP_PATH);
  const data = sanitizeDump(readDump(dumpPath));
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  console.log(`📄 Dump: ${dumpPath}`);
  console.log(`🧹 Filas anonimizadas: ${JSON.stringify(counts)}`);
  if (hasFlag('dry-run')) {
    console.log('ℹ️  --dry-run: no se escribió nada.');
    return;
  }

  const client = await connect({ writes: true });
  try {
    await client.query('BEGIN');
    await upsertRows(client, { table: 'users', pk: ['user_id'] }, data.sanitizedUsers);
    await upsertRows(client, { table: 'user_profiles', pk: ['profile_id'] }, data.profiles);
    await upsertRows(client, { table: 'notification_preferences', pk: ['user_id'] }, data.notificationPreferences);
    await upsertRows(client, { table: 'training_sessions', pk: ['session_id'] }, data.sessions);
    await upsertRows(client, { table: 'recommendations', pk: ['recommendation_id'] }, data.recommendations);
    await upsertRows(client, { table: 'user_product_feedback', pk: ['feedback_id'] }, data.feedback);
    for (const [table, column] of [
      ['users', 'user_id'],
      ['user_profiles', 'profile_id'],
      ['training_sessions', 'session_id'],
      ['recommendations', 'recommendation_id'],
      ['user_product_feedback', 'feedback_id'],
    ]) {
      await syncIdentity(client, table, column);
    }
    await client.query('COMMIT');
    console.log('✅ Historial anonimizado importado.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('importUsersSanitized.js')) {
  main().catch((error) => {
    console.error('❌ Error importando usuarios anonimizados:', error.message);
    process.exit(1);
  });
}
