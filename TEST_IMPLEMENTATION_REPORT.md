# TEST_IMPLEMENTATION_REPORT.md

Informe de implementación y ejecución de la suite de pruebas para la tesis (SportBack-funcionalBack + Sport-Funcional).

**Fecha de ejecución:** 2026-08-21  
**Entorno:** Windows, XAMPP (MariaDB 10.4.32), Node.js, BD de test `sport_test` separada de `sport`.

---

## 1. Herramientas instaladas

### Backend (`SportBack-funcionalBack`)
| Herramienta | Versión | Uso |
|---|---|---|
| Vitest | ^4.1.11 | Runner de pruebas unitarias, integración, seguridad y RAG |
| @vitest/coverage-v8 | ^4.1.11 | Cobertura de código |
| Supertest | ^7.2.2 | Pruebas HTTP contra Express |

### Frontend (`Sport-Funcional`)
| Herramienta | Versión | Uso |
|---|---|---|
| Jest | ~29.7.0 | Runner (preset jest-expo) |
| jest-expo | ~54.0.0 | Entorno Expo/RN |
| @testing-library/react-native | ^14.0.1 | Renderizado y queries de componentes |
| @testing-library/jest-native | ^5.4.3 | Matchers adicionales |

---

## 2. Archivos creados/modificados

### Backend — creados
- `app.js` — app Express exportable para Supertest
- `.env.test` / `.env.test.example` — configuración de test
- `vitest.config.js`
- `test/setup.js`
- `test/db/setupTestDb.js`, `test/db/resetTestDb.js`
- `test/helpers/authHelpers.js`, `requestHelpers.js`, `sqliPayloads.js`
- `test/unit/*.test.js` (6 archivos)
- `test/integration/flows.test.js`
- `test/security/security.test.js`
- `test/rag/vectorFlow.test.js`
- `scripts/performanceTest.js`
- `test-results/performance-results.json`, `performance-results.csv`

### Backend — modificados (testabilidad mínima)
- `server.js` — delega en `app.js`
- `routes/authRoutes.js`, `routes/recommendations.js` — rate limits por env
- `services/llmService.js` — `MOCK_LLM`, export `getFallbackRecommendations`
- `services/embeddingServices.js` — `MOCK_EMBEDDINGS`
- `services/retrievalService.js` — export `getCandidateProductsWithSQL`
- `package.json` — scripts de test

### Frontend — creados
- `jest.setup.js`
- `__tests__/*.test.ts(x)` (7 archivos)

### Frontend — modificados
- `src/utils/validation.ts` — helpers de validación de perfil y duración
- `package.json` — scripts `test`, `test:watch`, `test:coverage`

---

## 3. Estructura de pruebas

```
SportBack-funcionalBack/
  test/
    unit/           auth, profile, training, recommendation, retrievalSql, feedback
    integration/    flujos 1-5
    security/       JWT, ownership, rate limit, SQLi, Helmet, body limit
    rag/            USE_VECTOR_SEARCH true/false
    db/             setup y reset de sport_test
    helpers/
  scripts/performanceTest.js

Sport-Funcional/
  __tests__/        validation, AuthForm, AddTrainingModal, TrainingDetailModal, hooks/API
```

---

## 4. Pruebas unitarias backend implementadas

| Módulo | Tests | Archivo |
|---|---:|---|
| Autenticación (registro, login, JWT, bcrypt, token inválido/expirado) | 9 | `test/unit/auth.test.js` |
| Perfil (crear, actualizar, edad, incompletos, restricciones) | 5 | `test/unit/profile.test.js` |
| Sesiones (CRUD, propiedad) | 6 | `test/unit/training.test.js` |
| Recomendación (embedding mock, coseno, LLM mock, fallback) | 7 | `test/unit/recommendation.test.js` |
| Recuperación SQL | 4 | `test/unit/retrievalSql.test.js` |
| Feedback | 4 | `test/unit/feedback.test.js` |

**Subtotal unitarias backend:** 35 tests

---

## 5. Pruebas de integración implementadas

| Flujo | Descripción | Tests |
|---|---|---:|
| FLUJO 1 | register → login → JWT en endpoint protegido | 1 |
| FLUJO 2 | login → perfil → consultar → actualizar | 1 |
| FLUJO 3 | training → polling → 4 recomendaciones (MOCK_LLM) | 1 |
| FLUJO 4 | feedback negativo → exclusión en nueva sesión | 1 |
| FLUJO 5 | catálogo → filtros → detalle `/full` | 1 |
| HTTP | 400, 401, 403, 404, 409 | 1 |

**Subtotal integración:** 6 tests (`test/integration/flows.test.js`)

---

## 6. Pruebas de frontend implementadas

| Área | Tests | Archivo |
|---|---:|---|
| Validación email, edad, peso, altura, duración | 5 | `__tests__/validation.test.ts` |
| AuthForm render e interacción | 2 | `__tests__/AuthForm.test.tsx` |
| Login (campos vacíos, email, error 401) | 3 | `__tests__/useLoginWithProfileRedirect.test.ts` |
| AddTrainingModal (render, duración vacía) | 2 | `__tests__/AddTrainingModal.test.tsx` |
| TrainingDetailModal (recomendaciones, Bueno/Malo, loading) | 3 | `__tests__/TrainingDetailModal.test.tsx` |
| Historial API mockeado | 1 | `__tests__/useSavedRecommendationsData.test.ts` |
| Invalidación de sesión | 1 | `__tests__/sessionInvalidation.test.ts` |

**Subtotal frontend:** 17 tests

**Nota:** Las guardas de navegación de `AuthContext` (sin sesión / sin perfil / con perfil) y los switches de preferencias de notificación en `profile.tsx` **no tienen prueba de componente E2E automatizada** por la complejidad de montar expo-router + AuthProvider; la lógica de validación de login sí está cubierta.

---

## 7. Pruebas de seguridad implementadas

Archivo: `test/security/security.test.js` (9 tests)

- Endpoint protegido sin JWT → 401
- JWT inválido → 401
- JWT expirado → 401
- Perfil de otro usuario → 403
- Sesión de otro usuario → 403
- Rate limiting en login (429 tras superar límite configurado)
- Payloads SQLi → tablas intactas
- Cabeceras Helmet (`x-content-type-options`)
- Body JSON > 100 KB → 413

**Alcance declarado:** pruebas automatizadas de controles de seguridad implementados. **No** constituye auditoría completa de ciberseguridad.

---

## 8. Pruebas de rendimiento implementadas

Script: `scripts/performanceTest.js`

- **Automatizado (mock):** `npm run test:performance` — 20 ejecuciones secuenciales
- **Manual (APIs reales):** `npm run test:performance:real` — **no ejecutado automáticamente**

### Resultados reales (modo mock, 2026-08-21)

| Métrica | Valor |
|---|---:|
| Ejecuciones exitosas | 20/20 |
| Errores | 0 |
| Tiempo mínimo | 217 ms |
| Tiempo máximo | 594 ms |
| Promedio | 263 ms |
| Mediana | 221 ms |
| Desviación estándar | 99.7 ms |

Evidencia: `test-results/performance-results.json`, `test-results/performance-results.csv`

---

## 9. Pruebas RAG vectorial

Archivo: `test/rag/vectorFlow.test.js` (4 tests)

Con `USE_VECTOR_SEARCH=true`:
- Embedding de perfil 768 dimensiones (MOCK_EMBEDDINGS)
- Similitud coseno con embeddings reales del catálogo en BD
- Flujo completo training → 4 recomendaciones persistidas

Con `USE_VECTOR_SEARCH=false`:
- Recuperación SQL alternativa → recomendaciones generadas

---

## 10. Pruebas fallback SQL

- Unitarias: `test/unit/retrievalSql.test.js` (candidatos, filtros, exclusión, LIMIT 20)
- Integración/RAG: camino SQL con `USE_VECTOR_SEARCH=false`

---

## 11. Número TOTAL de tests

| Repositorio | Tests |
|---|---:|
| Backend | 54 |
| Frontend | 17 |
| **TOTAL** | **71** |

---

## 12. Número de tests aprobados

| Repositorio | Aprobados |
|---|---:|
| Backend | 54 |
| Frontend | 17 |
| **TOTAL** | **71** |

---

## 13. Número de tests fallidos

**0** (en la última ejecución completa del 2026-08-21)

---

## 14. Cobertura real

### Backend (`npm run test:coverage`)
| Métrica | % |
|---|---:|
| Statements | 53.78 |
| Branches | 47.12 |
| Functions | 76.59 |
| Lines | 53.70 |

### Frontend (`npm run test:coverage`)
| Métrica | % |
|---|---:|
| Statements | 6.86 |
| Branches | 7.94 |
| Functions | 8.47 |
| Lines | 7.13 |

La cobertura frontend es baja porque las pantallas `app/` (expo-router) no se ejecutan en Jest; las pruebas se centran en utilidades y componentes aislados.

---

## 15. Comandos exactos para reproducir

### Prerrequisitos
1. XAMPP con MariaDB activo
2. Copiar `.env.test.example` → `.env.test` y ajustar `DB_PASSWORD`
3. Crear BD de test: `cd SportBack-funcionalBack && npm run test:db:setup`

### Backend
```bash
cd SportBack-funcionalBack
npm test                  # todas (54)
npm run test:unit         # unitarias
npm run test:integration  # integración
npm run test:security     # seguridad
npm run test:rag          # RAG vectorial/SQL
npm run test:coverage     # cobertura
npm run test:performance  # rendimiento mock (20 runs)
# npm run test:performance:real  # MANUAL — APIs reales
```

### Frontend
```bash
cd Sport-Funcional
npm test
npm run test:coverage
```

---

## 16. Qué NO fue probado

- Modalidad `test:performance:real` con OpenAI/Gemini reales (solo documentada, no ejecutada)
- Guardas de navegación completas de `AuthContext` montadas con expo-router
- Pantallas `login.tsx`, `register.tsx`, `create-profile.tsx`, `profile.tsx` (notificaciones) de extremo a extremo
- CORS con origen rechazado (solo Helmet y flujo permisivo de desarrollo)
- Rate limiting del endpoint `POST /api/recommendations` (solo login)
- Edición de sesiones, endpoints granulares de producto sin UI
- Compatibilidad en dispositivos físicos / Expo Go
- Notificaciones push remotas (no existen en el sistema)
- Auditoría de penetración, análisis estático SAST/DAST completo

---

## 17. Afirmaciones CORRECTAS para la tesis

- Se implementó una suite automatizada re-ejecutable con **71 tests** (54 backend + 17 frontend), todos aprobados en la ejecución documentada.
- Las pruebas de integración usan la BD **`sport_test`**, separada de la BD de desarrollo `sport`.
- Las pruebas de recomendación usan **mocks** de LLM y embeddings en la suite estándar; no se consumen APIs pagadas en CI local automatizado.
- El flujo RAG vectorial (`USE_VECTOR_SEARCH=true`) y el fallback SQL (`false`) tienen pruebas dedicadas.
- Se midió rendimiento del flujo real POST training → polling GET recommendations (20 ejecuciones, promedio **263 ms** con mock).
- Controles de seguridad implementados (JWT, bcrypt, Helmet, rate limit, SQL parametrizado, ownership) tienen **pruebas automatizadas parciales**.
- Cobertura backend statements **~54%** (real, sin forzar 100%).

---

## 18. Afirmaciones NO CORRECTAS para la tesis

- ❌ "Auditoría de seguridad completa realizada"
- ❌ "100% de cobertura de código"
- ❌ "Pruebas E2E en dispositivo móvil real"
- ❌ "Métricas de rendimiento con LLM real en la suite automatizada"
- ❌ "Todas las pantallas del frontend probadas"
- ❌ "El sistema aprende del feedback positivo" (no verificado; solo exclusión negativa)
- ❌ "Pruebas de compatibilidad multiplataforma exhaustivas"

---

## 19. Limitaciones

- Rate limiter en memoria: contadores persisten mientras el proceso de test vive; se usa `fileParallelism: false` y límites altos en `.env.test` para evitar falsos 429.
- `MOCK_LLM`/`MOCK_EMBEDDINGS` son flags de entorno activados solo en test; alteran el camino de IA sin cambiar la lógica de negocio en producción.
- Frontend: Jest + RNTL no montan navegación expo-router completa; cobertura global frontend ~7%.
- Rendimiento con mock no refleja latencia real de OpenAI/Gemini (usar `test:performance:real` manualmente para tesis).

---

## 20. Mocks vs componentes reales

| Componente | Suite estándar | Suite real/manual |
|---|---|---|
| MariaDB | ✅ `sport_test` real | — |
| Express API | ✅ real | — |
| bcrypt / JWT | ✅ real | — |
| OpenAI / Gemini LLM | ❌ mock (`MOCK_LLM=true`) | `test:performance:real` |
| Embeddings Gemini | ❌ mock (`MOCK_EMBEDDINGS=true`) | `test:performance:real` |
| Catálogo productos | ✅ seed real desde `sport.sql` | — |
| Supertest HTTP | ✅ real | — |
| Componentes RN | ✅ render Jest (sin backend) | — |

---

## Tabla resumen de tipos de prueba

| Tipo de prueba | Implementada | Nº tests | Resultado | Evidencia |
| --- | --- | ---: | --- | --- |
| Unitarias backend | Sí | 35 | 35/35 OK | `npm run test:unit` |
| Integración backend | Sí | 6 | 6/6 OK | `npm run test:integration` |
| Seguridad backend | Sí | 9 | 9/9 OK | `npm run test:security` |
| RAG vectorial | Sí | 4 | 4/4 OK | `npm run test:rag` |
| Unitarias/componentes frontend | Sí | 17 | 17/17 OK | `cd Sport-Funcional && npm test` |
| Rendimiento (mock) | Sí | 20 runs | 20/20 OK | `test-results/performance-results.json` |
| Rendimiento (real) | Script listo | 0 runs | No ejecutado | `npm run test:performance:real` |
| Cobertura backend | Sí | — | 53.78% stmts | `npm run test:coverage` |
| Cobertura frontend | Sí | — | 6.86% stmts | `npm run test:coverage` |

---

## Tabla de afirmaciones para la tesis

| Afirmación para la tesis | ¿Se puede afirmar? | Evidencia |
| --- | --- | --- |
| Existen pruebas unitarias automatizadas del backend | **Sí** | 35 tests en `test/unit/` |
| Existen pruebas de integración con BD de test separada | **Sí** | `sport_test`, 6 tests |
| El flujo RAG vectorial está probado con mocks | **Sí** | `test/rag/vectorFlow.test.js` |
| Existe fallback SQL probado | **Sí** | `retrievalSql.test.js` + RAG false |
| Hay pruebas de seguridad automatizadas (parciales) | **Sí** | 9 tests; no auditoría completa |
| Hay pruebas de rendimiento reproducibles | **Sí** | 20/20 OK, JSON/CSV |
| Hay pruebas del frontend | **Sí (parcial)** | 17 tests componentes/utils |
| Cobertura total del proyecto > 80% | **No** | Backend ~54%, frontend ~7% |
| Se probó en Google Play / App Store | **No** | Sin despliegue |
| Comunicación HTTPS probada | **No** | HTTP local |

---

*Generado tras ejecutar realmente todas las suites automatizadas estándar. Cualquier fallo futuro debe documentarse con la salida de consola, no afirmarse como aprobado sin ejecución.*
