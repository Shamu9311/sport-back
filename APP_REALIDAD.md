# APP_REALIDAD.md — Estado real de la aplicación (auditoría de código)

> **Propósito:** documentar EXACTAMENTE lo que la aplicación hace hoy, con evidencia en código, para contrastarlo con lo que se afirme en una tesis de pregrado.
>
> **Método:** inspección directa de los dos repositorios (`SportBack-funcionalBack` y `Sport-Funcional`), del dump de base de datos (`sport.sql`) y de los archivos de configuración. Nada se infiere de comentarios, TODOs o documentación: cada afirmación cita el archivo que la demuestra.
>
> **Leyenda de estados:** ✅ IMPLEMENTADO · 🟡 PARCIALMENTE IMPLEMENTADO · ❌ NO IMPLEMENTADO

---

## 1. Arquitectura real

| Componente | Realidad | Evidencia |
|---|---|---|
| **Frontend** | App móvil multiplataforma con **Expo SDK ~54** (React Native 0.81.4, React 19.1.0), TypeScript, navegación con **expo-router ~6** (ruteo por archivos). | `Sport-Funcional/package.json` (líneas 13–60), `Sport-Funcional/app.json`, `Sport-Funcional/app/_layout.tsx` |
| **Backend** | API REST en **Node.js + Express 4.21.2**, módulos ES (`"type": "module"`), estructura clásica `routes → controllers → models/services`. | `SportBack-funcionalBack/package.json` (líneas 4–6, 24), `SportBack-funcionalBack/server.js` |
| **Base de datos** | **MariaDB 10.4.32** (ver §5) accedida con driver `mysql2/promise` mediante pool de conexiones (10 conexiones). | `SportBack-funcionalBack/config/db.js`, `SportBack-funcionalBack/sport.sql:7` |
| **Comunicación** | HTTP REST con JSON. El frontend usa **axios** con interceptor que agrega `Authorization: Bearer <JWT>`. La URL del API se toma de `EXPO_PUBLIC_API_URL` y por defecto es una IP de red local: `http://192.168.0.6:5000`. | `Sport-Funcional/src/services/api.ts:9-11, 22-37`, `Sport-Funcional/app.config.js:27-29`, `SportBack-funcionalBack/middleware/authMiddleware.js` |
| **Servicios externos** | OpenAI API y/o Google Gemini API (solo para recomendaciones/embeddings). Ningún otro servicio de terceros. | `SportBack-funcionalBack/services/llmService.js:4-7`, `SportBack-funcionalBack/services/embeddingServices.js:1` |

### Diagrama textual del flujo

```
┌──────────────────────────────┐
│  App Expo (React Native)     │
│  - Pantallas (expo-router)   │
│  - axios (api.ts)            │
│  - Notificaciones LOCALES    │
└──────────────┬───────────────┘
               │ HTTP/JSON + JWT Bearer
               ▼
┌──────────────────────────────┐        ┌─────────────────────────────┐
│  Backend Express (puerto     │──SQL──▶│  MariaDB 10.4.32 (sport)    │
│  5000, `node server.js`)     │        │  15 tablas, InnoDB          │
│                              │        └─────────────────────────────┘
│  Flujo de recomendación:     │
│  1. POST /api/training       │        ┌─────────────────────────────┐
│     guarda sesión            │──LLM──▶│ OpenAI gpt-3.5-turbo-0125   │
│  2. (async) perfil +         │        │   o Gemini 2.5-flash-lite   │
│     candidatos (SQL o        │        └─────────────────────────────┘
│     vectorial) → prompt      │        ┌─────────────────────────────┐
│  3. LLM devuelve 4 productos │──emb.─▶│ Gemini text-embedding-004   │
│  4. Guarda en `recommendations`      │ (768 dims, solo si          │
│  5. App hace polling y       │        │  USE_VECTOR_SEARCH=true)    │
│     muestra + feedback       │        └─────────────────────────────┘
└──────────────────────────────┘
```

**Punto clave de arquitectura:** la app **no** genera recomendaciones por el endpoint dedicado `POST /api/recommendations` (existe pero el frontend nunca lo llama). El flujo real es: la app crea una **sesión de entrenamiento** (`POST /api/training`), el backend genera las recomendaciones **de forma asíncrona** y la app hace **polling** a `GET /api/training/:id/recommendations` hasta obtenerlas.
Evidencia: `SportBack-funcionalBack/controllers/trainingController.js:39-56` (llamada asíncrona), `Sport-Funcional/src/services/api.ts:399-429` (`pollTrainingRecommendations`), `Sport-Funcional/app/(tabs)/training.tsx:104-116`.

---

## 2. Tecnologías realmente utilizadas

### Backend (`SportBack-funcionalBack/package.json`)

| Tecnología | Versión | Función real en el código |
|---|---|---|
| Node.js + Express | 4.21.2 | Servidor HTTP y enrutamiento (`server.js`) |
| mysql2 | ^3.14.1 | Pool de conexiones y consultas SQL parametrizadas (`config/db.js`, todos los `models/`) |
| bcryptjs | ^3.0.2 | Hash de contraseñas, costo 10 (`controllers/authController.js:46, 89`) |
| jsonwebtoken | ^9.0.2 | Emisión/verificación de JWT (`controllers/authController.js:90-97`, `middleware/authMiddleware.js:21`) |
| helmet | ^8.1.0 | Cabeceras HTTP de seguridad (`server.js:13`) |
| cors | ^2.8.5 | Control de orígenes (`server.js:14`, `config/appConfig.js:22-40`) |
| express-rate-limit | ^7.5.1 | Límite de peticiones (`server.js:17-24`, `routes/authRoutes.js:8-17`, `routes/recommendations.js:14-20`) |
| openai | ^4.100.0 | Cliente del LLM OpenAI (`services/llmService.js:4, 210-238`) |
| @google/generative-ai | ^0.24.1 | Cliente Gemini: LLM alternativo y embeddings (`services/llmService.js:5, 240-269`; `services/embeddingServices.js:1, 29`) |
| dotenv | ^16.5.0 | Variables de entorno (`server.js:3`) |
| nodemon (dev) | ^3.1.9 | Recarga en desarrollo (`package.json:8`) |

**NO está en las dependencias** (y por tanto no se usa): Sequelize/ORM (el `README.txt` lo menciona, pero no existe en `package.json` ni en el código; los modelos usan SQL crudo), Redis, LangChain/LangGraph, PM2, LogRocket, ningún SDK de AWS/Vercel/Firebase.

### Frontend (`Sport-Funcional/package.json`)

| Tecnología | Versión | Función real |
|---|---|---|
| Expo | ~54.0.0 | Plataforma de desarrollo/build |
| React Native / React | 0.81.4 / 19.1.0 | UI |
| expo-router | ~6.0.12 | Navegación por archivos (`app/`) |
| axios | ^1.8.1 | Cliente HTTP (`src/services/api.ts`) |
| @react-native-async-storage/async-storage | ^2.2.0 | Almacenamiento local del objeto usuario y token legacy/web (`src/services/tokenStorage.ts:18-25`, `src/context/AuthContext.tsx:29-30`) |
| expo-secure-store | ^56.0.4 | Almacenamiento del JWT en nativo (`src/services/tokenStorage.ts:13-16`) |
| expo-notifications | ^0.32.13 | **Notificaciones locales** programadas en el dispositivo (`src/services/notificationService.ts`) |
| @react-navigation/* | 7.x | Navegación subyacente de expo-router |
| date-fns | ^4.1.0 | Formato de fechas |
| react-native-toast-message | ^2.2.1 | Mensajes toast (`app/_layout.tsx:104-128`) |
| @expo-google-fonts/inter | ^0.4.2 | Tipografía |
| TypeScript | ~5.9.2 | Tipado |
| jest + jest-expo (dev) | ~29.7.0 / ~54.0.0 | **Configurados pero sin ninguna prueba escrita** (ver §8) |

---

## 3. Frontend

### 3.1 Pantallas realmente existentes (archivos en `Sport-Funcional/app/`)

| Pantalla | Archivo | Qué hace realmente |
|---|---|---|
| Login | `app/login.tsx` | Formulario email/contraseña; valida campos vacíos y formato de email; redirige según tenga perfil o no (`src/hooks/useLoginWithProfileRedirect.ts`) |
| Registro | `app/register.tsx` | Formulario usuario/email/contraseña; valida formato de email; tras registrar hace login automático y envía a crear perfil |
| Carga de perfil | `app/loading-profile.tsx` | Spinner mientras `AuthContext` verifica si el usuario tiene perfil |
| Crear perfil (wizard 4 pasos) | `app/create-profile.tsx` | Recoge datos personales, actividad, objetivos, restricciones (detalle en §3.3) |
| Inicio (tab) | `app/(tabs)/index.tsx` | Saludo, estadísticas (entrenos de la semana, minutos totales — calculados desde `GET /training/user/:id`), carrusel de funciones, accesos rápidos |
| Productos (tab) | `app/(tabs)/products.tsx` | Catálogo con buscador, filtro por categoría y por momento de consumo, paginación de 20, pull-to-refresh |
| Detalle de producto | `app/products/[productId].tsx` | Imagen, descripción, recomendación de uso, tabla nutricional, sabores, atributos (usa `GET /products/:id/full`) |
| Entrenar (tab) | `app/(tabs)/training.tsx` | Lista de sesiones, crear sesión (modal), eliminar con gesto, abrir detalle; al crear dispara la generación de recomendaciones y hace polling |
| Modal nueva sesión | `src/components/AddTrainingModal.tsx` | Formulario de sesión (detalle en §3.3) |
| Modal detalle sesión | `src/components/TrainingDetailModal.tsx` | Datos de la sesión + recomendaciones generadas + botones de feedback **Bueno/Malo** |
| Sugerencias (tab) | `app/(tabs)/recommendations.tsx` | Historial de recomendaciones guardadas, separadas en "Que me sirvieron" / "No me sirvieron" según el feedback del usuario |
| Perfil (tab) | `app/(tabs)/profile.tsx` | Datos del usuario y del perfil, edición del perfil (`src/components/profile/PersonalDataForm.tsx`), preferencias de notificación, cerrar sesión |
| 404 | `app/+not-found.tsx` | Página estándar de ruta no encontrada |

### 3.2 Navegación

- **expo-router** con `Stack` raíz (`app/_layout.tsx:130-143`) y `Tabs` con 5 pestañas: Inicio, Productos, Entrenar, Sugerencias, Perfil (`app/(tabs)/_layout.tsx`).
- **Guardas de navegación** en `src/context/AuthContext.tsx:104-125`: sin sesión → `/login`; con sesión sin perfil → `/create-profile`; con perfil → tabs. La verificación de perfil llama a `GET /api/profile/:userId/profile` (`src/services/api.ts:131-146`).

### 3.3 Formularios, datos solicitados y validaciones

**Registro/Login** (`app/register.tsx`, `app/login.tsx`, `src/components/AuthForm.tsx`):
- Datos: username, email, password.
- Validación frontend: campos obligatorios + regex de email (`src/utils/validation.ts`). Validación backend adicional: email duplicado → 409, usuario duplicado → 409 (`SportBack-funcionalBack/controllers/authController.js:16-41`).

**Perfil** (`app/create-profile.tsx`, wizard de 4 pasos con valores por defecto ya rellenos):
- Datos: edad, peso (kg), altura (cm), género (hombre/mujer/otro), nivel de actividad (sedentario/ligero/moderado/activo/muy_activo), frecuencia de entrenamiento (ocasional/regular/frecuente/diario), objetivo principal (rendimiento/resistencia/fuerza/recuperacion/perdida_peso/salud_general), nivel de sudoración (bajo/medio/alto), tolerancia a cafeína (baja/media/alta), restricciones dietéticas (ninguna/vegetariano/vegano/sin_gluten/sin_lactosa).
- **Dato capturado pero NO persistido:** el wizard también recoge `allergies` y `preferred_supplements` (`app/create-profile.tsx:94-95`), pero el backend los ignora: `userModel.createUserProfile` solo inserta los 10 campos anteriores (`SportBack-funcionalBack/models/userModel.js:127-226`). No existen columnas para alergias ni suplementos preferidos en `user_profiles` (`sport.sql:930-956`).
- Validación frontend: edad/peso/altura obligatorios y solo numéricos; validación backend: edad entre 12 y 120 (`SportBack-funcionalBack/controllers/profileController.js`).

**Sesión de entrenamiento** (`src/components/AddTrainingModal.tsx`):
- Datos: fecha, hora de inicio, duración (min), intensidad (baja/media/alta), tipo (entrenamiento/competencia), tipo de deporte (ciclismo/running/gimnasio/triatlon/natacion/otro), clima (templado/calor/frio/lluvia/humedo), notas.
- Validación: duración numérica positiva; hora 0–23 y minuto 0–59.

**Preferencias de notificación** (`app/(tabs)/profile.tsx`):
- Switches de recordatorios de consumo y alertas de entrenamiento; hora preferida validada con regex `HH:MM`. Persisten en `notification_preferences` vía `PUT /api/notifications/preferences/:userId`.

### 3.4 Historial, configuración y feedback

- **Historial de entrenamientos:** lista completa en tab Entrenar (`GET /api/training/user/:userId`).
- **Historial de recomendaciones:** tab Sugerencias (`GET /api/recommendations/saved`).
- **Historial de feedback:** `GET /api/recommendations/user-feedback`, usado para clasificar las sugerencias en "me sirvieron / no me sirvieron" (`src/hooks/useSavedRecommendationsData.ts`).
- **Feedback Bueno/Malo:** botones en `TrainingDetailModal.tsx:239-263` → `POST /api/recommendations/product-feedback`.
- **Configuración:** solo preferencias de notificación y edición de perfil. No hay pantalla de ajustes general, ni cambio de contraseña, ni borrado de cuenta.

### 3.5 Notificaciones

- **Solo locales** (`src/services/notificationService.ts`): al generarse recomendaciones se programan recordatorios de consumo en el dispositivo (antes/durante/después/diario, con repeticiones por intervalo) y una alerta diaria de entrenamiento. **No hay notificaciones push remotas** (no hay servidor de push, ni Expo Push Tokens en la BD).
- Limitación explícita en código: no funcionan en Expo Go ni en web (`notificationService.ts:10-15`, `StoreClient` check).

### 3.6 Funcionalidades mencionadas en código pero NO terminadas / no usadas

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Editar sesión de entrenamiento | 🟡 Backend y función axios existen, pero **ninguna pantalla la invoca** | `SportBack-funcionalBack` `routes/training.js` (PUT), `Sport-Funcional/src/services/api.ts:373` (`updateTrainingSession` sin llamadores) |
| Listar productos por categoría (endpoint dedicado) | 🟡 Existe en backend y axios, sin uso en UI (la UI filtra vía `/products/search`) | `api.ts:226` (`getProductsByCategory` sin llamadores) |
| Precio de productos | ❌ La UI referencia `product.price` con fallback a 0, pero la tabla `products` **no tiene columna price** | `app/(tabs)/products.tsx`, `sport.sql:330-352` |
| Alergias y suplementos preferidos | 🟡 Se capturan en el wizard, no se guardan | `app/create-profile.tsx:94-95` vs `models/userModel.js:127-226` |
| Script `reset-project` | ❌ Referenciado en `package.json:11` pero `scripts/reset-project.js` no existe | `Sport-Funcional/package.json` |

---

## 4. Backend / API

### 4.1 Endpoints existentes

Base: `server.js:43-48`. Autenticación: 🔓 público · 🔒 JWT requerido · 🔒+ JWT + verificación de propiedad.

| Método y ruta | Auth | Función | Evidencia |
|---|---|---|---|
| GET `/api/health` | 🔓 | Verifica conexión a BD | `server.js:27-40` |
| POST `/api/auth/register` | 🔓 (rate limit 10/15min) | Registro; hash bcrypt; crea `notification_preferences` por defecto | `routes/authRoutes.js:8-17`, `controllers/authController.js:8-73` |
| POST `/api/auth/login` | 🔓 (rate limit 10/15min) | Login; compara bcrypt; emite JWT (7 días) | `controllers/authController.js:75-129` |
| POST `/api/profile/:userId/profile` | 🔒+ | Crea o actualiza el perfil (upsert) | `routes/profile.js`, `models/userModel.js:127-226` |
| GET `/api/profile/:userId/profile` | 🔒+ | Obtiene perfil (usado por el guarda de navegación) | `routes/profile.js` |
| GET `/api/products/search` | 🔓 | Búsqueda con filtros (texto, categoría, timing, tipo) y paginación | `routes/products.js`, `models/productModel.js` |
| GET `/api/products/categories` | 🔓 | Lista categorías | `routes/products.js` |
| GET `/api/products/category/:categoryId` | 🔓 | Productos por categoría (sin uso en la app) | `routes/products.js` |
| GET `/api/products/:productId` | 🔓 | Detalle básico (sin uso directo en la app) | `routes/products.js` |
| GET `/api/products/:productId/nutrition` | 🔓 | Nutrición (sin uso directo) | `routes/products.js` |
| GET `/api/products/:productId/flavors` | 🔓 | Sabores (sin uso directo) | `routes/products.js` |
| GET `/api/products/:productId/attributes` | 🔓 | Atributos (sin uso directo) | `routes/products.js` |
| GET `/api/products/:productId/full` | 🔓 | Detalle completo (el que usa la app) | `routes/products.js`, `api.ts:296` |
| POST `/api/recommendations` | 🔒 (rate limit 30/15min) | Genera recomendaciones bajo demanda (RAG+LLM). **La app no lo usa** | `routes/recommendations.js:22-25`, `controllers/recommendationController.js` |
| GET `/api/recommendations/saved` | 🔒 | Historial de recomendaciones | `routes/recommendations.js` |
| POST `/api/recommendations/feedback` | 🔒 | Actualiza `recommendations.feedback` (legado; la app no lo usa) | `controllers/recommendationController.js` |
| POST `/api/recommendations/product-feedback` | 🔒 | Guarda feedback Bueno/Malo por producto (el que usa la app) | `controllers/recommendationController.js`, `models/feedbackModel.js` |
| GET `/api/recommendations/user-feedback` | 🔒 | Historial de feedback del usuario | `routes/recommendations.js` |
| GET `/api/training/user/:userId` | 🔒+ | Lista sesiones del usuario | `routes/training.js` |
| POST `/api/training` | 🔒 | Crea sesión y **dispara generación asíncrona de recomendaciones** | `controllers/trainingController.js:20-58` |
| GET `/api/training/:id/recommendations` | 🔒+ (dueño de la sesión) | Recomendaciones de una sesión (polling de la app) | `routes/training.js` |
| GET `/api/training/:id` | 🔒+ | Detalle de sesión | `routes/training.js` |
| PUT `/api/training/:id` | 🔒+ | Actualiza sesión (sin uso en la app) | `routes/training.js` |
| DELETE `/api/training/:id` | 🔒+ | Elimina sesión y sus recomendaciones (transacción) | `models/trainingSessionModel.js` (`deleteSession`) |
| GET `/api/notifications/preferences/:userId` | 🔒+ | Lee preferencias de notificación | `routes/notifications.js` |
| PUT `/api/notifications/preferences/:userId` | 🔒+ | Guarda preferencias de notificación | `routes/notifications.js` |

**Observación:** los endpoints de catálogo (`/api/products/*`) son **públicos**, sin JWT. Es una decisión visible en `routes/products.js` (ninguna ruta usa `authMiddleware`).

### 4.2 Autenticación y autorización

- **Autenticación:** JWT firmado con `JWT_SECRET` (obligatorio en producción, con fallback de desarrollo), expiración 7 días por defecto (`config/appConfig.js:6-13`, `authController.js:90-97`). Payload: `{ id, email }`.
- **Middleware JWT:** `middleware/authMiddleware.js` — extrae `Bearer`, verifica, adjunta `req.user`; distingue token expirado (`TokenExpiredError`) de inválido.
- **Autorización por propiedad:** `middleware/ownershipMiddleware.js` — `requireMatchingUserId` compara `req.params.userId` con `req.user.id`; `requireTrainingSessionOwner` verifica que la sesión pertenezca al usuario autenticado.
- **No hay roles** (admin/usuario), ni refresh tokens, ni revocación de tokens: el logout es solo del lado cliente (`AuthContext.tsx` borra almacenamiento local).

### 4.3 Middlewares globales

`server.js:12-24`: `helmet()` → `cors(getCorsOptions())` → `express.json({ limit: '100kb' })` → rate limit global (200 req / 15 min). Rate limits adicionales en auth (10/15 min) y recomendaciones (30/15 min).

### 4.4 Manejo de errores

- Handler global `middleware/errorHandler.js`: log en consola y respuesta JSON genérica; en producción oculta el detalle del error.
- 404 centralizado (`notFoundHandler`).
- Controladores con try/catch que devuelven códigos 400/401/403/404/409/500 según el caso.
- El frontend tiene interceptor axios que ante un 401 invalida la sesión y limpia el almacenamiento (`api.ts:39-63`, `src/services/sessionInvalidation.ts`, `src/services/errorService.ts`).

---

## 5. Base de datos

### 5.1 Motor realmente utilizado

- **MariaDB 10.4.32.** El dump `sport.sql` fue generado con phpMyAdmin 5.2.1 y declara en su cabecera: `Versión del servidor: 10.4.32-MariaDB` (`sport.sql:7`). El entorno del dump es `127.0.0.1 via TCP/IP` con PHP 8.2.12 (típico XAMPP local).
- El código se conecta con el driver **`mysql2`** (`config/db.js`), compatible con ambos motores; los comentarios del código dicen "MySQL", pero **el servidor real del dump es MariaDB**. Para la tesis: lo correcto es decir **MariaDB 10.4.32 (compatible con el protocolo de MySQL, accedido mediante el driver mysql2)**.
- Motor de tablas: **InnoDB**, charset **utf8mb4** (`sport.sql`, cláusulas `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).

### 5.2 Tablas existentes (15) y datos almacenados

| Tabla | Contenido | Filas en el dump |
|---|---|---|
| `users` | id, username, email (UNIQUE), password (hash bcrypt `$2b$10$...`), created_at | 11 |
| `user_profiles` | age, weight, height, gender, activity_level, training_frequency, primary_goal, sweat_level, caffeine_tolerance, dietary_restrictions (ENUMs en español) | 7 |
| `products` | name, description, brand, usage_context, usage_recommendation, image_url, type_id, is_active | 50 (catálogo SiS) |
| `product_categories` | Categorías de producto | 4 |
| `product_types` | Tipos dentro de cada categoría | 18 |
| `product_attributes` | Atributos dietéticos/funcionales (vegano, sin gluten, con cafeína, etc.) | 11 |
| `product_attributes_mapping` | Relación producto↔atributo | sí |
| `flavors` | Sabores | 26 |
| `product_flavors` | Relación producto↔sabor | sí |
| `product_nutrition` | Valores nutricionales por producto (calorías, carbohidratos, proteína, sodio, cafeína, etc.) | sí |
| `product_embeddings` | embedding (JSON de 768 dimensiones, `CHECK (json_valid(...))`), model, timestamps | 50 |
| `training_sessions` | user_id, session_date, start_time, duration_min, intensity, type, weather, sport_type, notes | 8 |
| `recommendations` | user_id, session_id (nullable), product_id, recommended_at, feedback (nullable), feedback_notes, consumption_timing, consumption_instructions, recommended_quantity, timing_minutes | 42 |
| `user_product_feedback` | user_id, product_id, feedback_type (positivo/negativo), UNIQUE(user,product) | 6 |
| `notification_preferences` | user_id, consumption_reminders, training_alerts, preferred_time | 11 |

Evidencia: `sport.sql:30-1009` (CREATE TABLE e INSERTs).

### 5.3 Relaciones principales (claves foráneas en el dump)

- `products.type_id → product_types.id → product_categories.id`
- `product_attributes_mapping`, `product_flavors`, `product_nutrition`, `product_embeddings` → `products.id`
- `user_profiles.user_id → users.id`; `training_sessions.user_id → users.id`
- `recommendations.user_id → users.id`, `recommendations.session_id → training_sessions.id`, `recommendations.product_id → products.id`
- `user_product_feedback` → `users.id` y `products.id`; `notification_preferences.user_id → users.id`

### 5.4 Índices

- Primarios en todas las tablas; índices de FK automáticos.
- `users.email` tiene **dos** claves UNIQUE redundantes (`email` y `email_2`) — detalle menor del esquema.
- `user_product_feedback`: `UNIQUE unique_user_product`, `idx_user_feedback`, `idx_product_feedback`.
- `product_embeddings`: `idx_product_embeddings` (product_id).
- Existe el script `add_recommendations_indexes.sql` (índices `idx_rec_user_date`, `idx_rec_user_product`), pero **esos índices no aparecen en el dump**, por lo que no puede confirmarse que estén aplicados.

### 5.5 Aviso de privacidad

`sport.sql` **está versionado en git** (`git ls-files` lo lista) y contiene 11 emails de usuarios y sus hashes de contraseña. El `.gitignore` sí excluye `.env`. Esto debe mencionarse como riesgo, no como buena práctica.

---

## 6. Sistema de recomendación e IA (flujo real, en detalle)

### 6.1 Punto de entrada real

El flujo que usa la app es el de **sesión de entrenamiento**:

1. La app envía `POST /api/training` con los datos de la sesión.
2. `trainingController.createSession` guarda la sesión y responde de inmediato; luego, **en segundo plano**, llama a `TrainingRecommendationService.generateTrainingRecommendations(userId, sessionId, trainingData)` (`controllers/trainingController.js:39-56`).
3. La app hace polling a `GET /api/training/:id/recommendations` (hasta 5 intentos, cada 4 s; el modal reintenta 5 veces más cada 2 s) (`api.ts:399-429`, `TrainingDetailModal.tsx`).

Existe además `POST /api/recommendations` (generación bajo demanda, `controllers/recommendationController.js`) con la misma lógica interna, pero **ninguna pantalla del frontend lo invoca**.

### 6.2 Datos que recibe del deportista

- **Del perfil** (`user_profiles`): edad, peso, altura, género, nivel de actividad, frecuencia de entrenamiento, objetivo principal, nivel de sudoración, tolerancia a cafeína, restricciones dietéticas. Si no hay perfil, se usa uno por defecto (30 años, 70 kg, 170 cm, etc.) (`services/trainingRecommendationService.js`).
- **De la sesión**: fecha, hora, duración, intensidad, tipo (entrenamiento/competencia), deporte, clima, notas.
- **Del historial de feedback**: productos con feedback negativo (para excluirlos) y positivo (ver matiz en §6.6).

### 6.3 Selección de productos candidatos — dos caminos (`services/retrievalService.js`)

El conmutador es la variable de entorno **`USE_VECTOR_SEARCH`** (`retrievalService.js:8, 16-29`). En `.env.example` su valor por defecto es **`false`** (`.env.example:19`), y el código solo lo activa con el string exacto `'true'`. Como el `.env` real no está en el repositorio, **no puede afirmarse que la búsqueda vectorial esté activa en un despliegue concreto**; lo que sí está probado es que ambos caminos existen y que los 50 productos tienen embeddings generados en la BD.

**Camino A — SQL (por defecto):** `getCandidateProductsWithSQL` (`retrievalService.js:180-358`):
- Consulta directa sobre `products` + `product_nutrition` + atributos.
- Filtros duros: productos activos, exclusión de productos con feedback negativo, compatibilidad con restricciones dietéticas (mapeo de atributos), filtro de cafeína según tolerancia.
- Ordenamiento heurístico por `primary_goal` y `activity_level` (ORDER BY ponderado), `LIMIT 20`.

**Camino B — Vectorial (RAG):** (`retrievalService.js:32-177` + `services/vectorSearchService.js`):
1. Se genera el embedding del perfil del usuario con **Gemini `text-embedding-004`** (768 dimensiones) (`services/embeddingServices.js:29`).
2. Se cargan los embeddings de productos (pool pre-filtrado, `LIMIT 100`) y se calcula la **similitud coseno en JavaScript** (no en la base de datos; no hay índice vectorial ni extensión tipo pgvector) (`vectorSearchService.js`).
3. Se toman los 30 más similares, se reexcluyen los de feedback negativo, se enriquecen con datos completos y se aplican los mismos filtros duros (restricciones, cafeína). Resultado: hasta 20 candidatos.

### 6.4 LLM realmente configurado (`services/llmService.js`)

- **Proveedor:** variable `LLM_PROVIDER`; por defecto **`openai`** (`llmService.js:6`, `.env.example:22`).
- **OpenAI:** modelo **`gpt-3.5-turbo-0125`**, `temperature: 0.3`, `max_tokens: 1200`, `response_format: json_object` (`llmService.js:215, 220-222`).
- **Gemini (alternativa):** modelo **`gemini-2.5-flash-lite`**, `temperature: 0.3`, `maxOutputTokens: 1200`, con limpieza de markdown de la respuesta (`llmService.js:39, 240-269`).
- **Embeddings:** siempre Gemini `text-embedding-004` (requiere `GEMINI_API_KEY`), independientemente del `LLM_PROVIDER`.
- Qué proveedor se usa en la práctica depende del `.env` (no versionado): lo honesto es decir "configurable; OpenAI por defecto, Gemini como alternativa; embeddings siempre con Gemini".

### 6.5 Construcción del prompt y generación

`llmService.js` construye:
- **System prompt:** define al asistente "SportNutriBot", nutricionista deportivo, con instrucciones de responder **solo JSON** y de priorizar productos evaluados positivamente "si están disponibles".
- **User prompt:** perfil del deportista + detalles de la sesión + lista JSON de productos candidatos (id, nombre, descripción, contexto de uso, datos nutricionales). Exige **exactamente 4 recomendaciones** con `consumption_timing` distintos (`antes`, `durante`, `despues`, `diario`), cada una con `reasoning`, `timing_minutes`, `interval_minutes`, `recommended_quantity` e `instructions` (documentado también en `IMPLEMENTACION_TIMING_CONSUMO.md`).

**Fallback sin LLM** (`llmService.js:309-512`, `getFallbackRecommendations`): si no hay API key o la llamada falla, se aplica un scoring por reglas (objetivo → proteína/carbohidratos/calorías; penalizaciones por restricciones y cafeína), distribución de timings por heurísticas sobre `usage_context`/nombre, y textos de razonamiento genéricos ("Este producto es adecuado para tu perfil...").

### 6.6 Guardado y feedback

- **Guardado:** cada recomendación se inserta en `recommendations` con `user_id`, `session_id`, `product_id`, `consumption_timing`, `timing_minutes`, `recommended_quantity` e `instructions` (el razonamiento del LLM se guarda truncado en `feedback_notes`) (`models/recommendationModel.js:26-75`, `services/trainingRecommendationService.js:114-124`).
- **Detalle de honestidad técnica:** `trainingRecommendationService.js:119` calcula `score: rec.score || Math.floor(Math.random() * 50) + 50` — un **número aleatorio** cuando el LLM no devuelve score. Además, la tabla `recommendations` **no tiene columna `score`**, así que ese valor nunca se persiste. En la tesis no debe hablarse de "puntuación de confianza" del sistema.
- **Feedback Bueno/Malo:** botones de la app → `POST /api/recommendations/product-feedback` → upsert en `user_product_feedback` (`models/feedbackModel.js`).
  - Feedback **negativo**: excluye el producto de futuras recomendaciones (ambos caminos, SQL y vectorial). ✅ efecto real.
  - Feedback **positivo**: en el camino vectorial solo se registra en un `console.log` (`retrievalService.js`); en el camino SQL ni siquiera se consulta. El system prompt pide al LLM "priorizar" productos bien evaluados, pero la lista de candidatos que recibe el LLM **no indica cuáles tienen feedback positivo**, por lo que esa instrucción es ineficaz. 🟡 El feedback positivo se almacena y se muestra en el historial, pero **no influye realmente en las siguientes recomendaciones**.
- Existe además el endpoint legado `POST /api/recommendations/feedback` que actualiza la columna `recommendations.feedback`; la app no lo usa.

### 6.7 ¿Es RAG?

Sí, en el sentido del patrón *retrieval-augmented generation*: se recuperan candidatos (vectorial o SQL) y se **aumenta el prompt** con ellos antes de generar. Pero **sin framework** (no LangChain/LangGraph), **sin base de datos vectorial** (la similitud coseno se calcula en memoria, en JS) y con el camino vectorial **desactivado por defecto** (`USE_VECTOR_SEARCH=false`).

---

## 7. Existencia explícita de tecnologías/prácticas

| Elemento | Estado | Evidencia |
|---|---|---|
| Fine-tuning | ❌ NO EXISTE | No hay scripts ni datasets de entrenamiento; solo llamadas a APIs |
| Entrenamiento propio de un LLM | ❌ NO EXISTE | Se consumen modelos pre-entrenados vía API (`llmService.js`) |
| RLHF | ❌ NO EXISTE | El feedback se guarda y solo se usa para excluir productos; nunca reentrena nada |
| LangGraph / LangChain | ❌ NO EXISTE | No están en `package.json` ni en imports |
| Redis | ❌ NO EXISTE | No está en dependencias ni en código |
| PM2 | ❌ NO EXISTE | No hay `ecosystem.config.js`; se ejecuta con `node server.js` / `nodemon` |
| LogRocket | ❌ NO EXISTE | Sin SDK de monitoreo en ninguno de los dos repos |
| AWS | ❌ NO EXISTE | Sin SDK, sin configuración, sin referencias |
| Vercel | ❌ NO EXISTE | Sin `vercel.json` ni configuración |
| Google Sign-In | ❌ NO EXISTE | Único login: email/contraseña (`app/login.tsx`, `authController.js`) |
| Apple Sign-In | ❌ NO EXISTE | Ídem |
| Modo offline | ❌ NO EXISTE | No hay BD local (sin expo-sqlite/WatermelonDB); todo dato viene del API; solo se cachea sesión. Hay banner de error de red (`NetworkErrorBanner`) |
| Cifrado de extremo a extremo | ❌ NO EXISTE | No hay cifrado aplicado por la app; en desarrollo el API se consume por **HTTP plano** a una IP local (`app.config.js:27-29`) |
| Rate limiting | ✅ EXISTE | `express-rate-limit`: global 200/15min (`server.js:17-24`), auth 10/15min (`authRoutes.js:8-17`), recomendaciones 30/15min (`routes/recommendations.js:14-20`). Limitación: store en memoria (se reinicia con el proceso) |
| Protección contra fuerza bruta | 🟡 PARCIAL | Únicamente el rate limit de `/api/auth/*`. No hay bloqueo de cuenta, CAPTCHA ni backoff progresivo |
| Protección SQL Injection | ✅ EXISTE | Consultas parametrizadas con placeholders `?` de `mysql2` en todos los modelos (`models/*.js`) |
| CORS | ✅ EXISTE | `config/appConfig.js:22-40`: en desarrollo refleja cualquier origen; en producción requiere whitelist por `CORS_ORIGIN` |
| bcrypt | ✅ EXISTE | `bcryptjs` (implementación JS pura), costo 10 (`authController.js:46`) |
| JWT | ✅ EXISTE | `jsonwebtoken`, expiración 7 días, payload `{id, email}` (`authController.js:90-97`, `authMiddleware.js`). Sin refresh token ni revocación |

---

## 8. Pruebas realmente implementadas

| Tipo | Estado | Evidencia |
|---|---|---|
| Unitarias | ❌ NO EXISTEN | Backend: `"test": "echo \"Error: no test specified\" && exit 1"` (`SportBack-funcionalBack/package.json:8`). Frontend: `jest`/`jest-expo` instalados y script `"test": "jest --watchAll"`, pero **no existe ningún archivo de prueba** (sin `__tests__/`, sin `*.test.*`, sin `*.spec.*` en todo el repo) |
| Integración | ❌ NO EXISTEN | Sin tests de API ni de BD |
| Rendimiento | ❌ NO EXISTEN | Sin benchmarks ni herramientas de carga |
| Seguridad | ❌ NO EXISTEN | Sin tests de seguridad ni análisis estático configurado |
| Compatibilidad | ❌ NO EXISTEN | Sin matriz ni pruebas por dispositivo |

**Únicos artefactos parecidos a pruebas:** `scripts/testVectorSearch.js` y `scripts/generateProductEmbeddings.js` son **scripts manuales de verificación/utilidad** que se ejecutan a mano con `node`, no pruebas automatizadas con aserciones. La guía `GUIA_RAG_IMPLEMENTACION.txt` los documenta como pasos manuales.

Conclusión para la tesis: **no se realizaron pruebas automatizadas de ningún tipo**. Solo es correcto afirmar "verificación manual mediante scripts y pruebas de uso durante el desarrollo".

---

## 9. Métricas que el sistema realmente puede medir

| Métrica | ¿Medible hoy? | Análisis según el código |
|---|---|---|
| **Latencia** (del API o del LLM) | ❌ NO | No se registra ningún timestamp de inicio/fin de las llamadas al LLM ni de los requests; solo hay `console.log` informativos. No hay tabla de métricas ni APM |
| **Cobertura** (productos con embedding) | 🟡 Calculable manualmente | No hay código que la compute, pero se puede obtener con SQL: en el dump, 50/50 productos tienen embedding (`product_embeddings`). No es una métrica que el sistema "mida" |
| **Tasa de aceptación** (feedback positivo / total) | 🟡 Calculable manualmente | Los datos existen (`user_product_feedback.feedback_type`, 6 filas en el dump), pero **ningún endpoint ni consulta del sistema la calcula**. Sería una query SQL ad-hoc |
| **Tasa de fallback** (cuántas veces se usó el fallback sin LLM) | ❌ NO | El fallback solo deja `console.log` (`llmService.js:309+`). El campo `promptUsed` que devuelve el servicio **no se persiste** en la BD. A lo sumo podría inferirse buscando los textos genéricos de razonamiento en `feedback_notes`, lo cual es frágil e indirecto |
| **Precisión** (precision@k, relevancia) | ❌ NO | No hay ground truth, ni conjunto de evaluación, ni harness de evaluación. El feedback Bueno/Malo es por producto recomendado, no una etiqueta de relevancia por ranking, y con 6 registros no permite una métrica seria |

**Conclusión:** el sistema **no instrumenta métricas**. Para la tesis, cualquier cifra de latencia, precisión o tasas tendría que obtenerse con mediciones externas ad-hoc y debe declararse como tal.

---

## 10. Despliegue

| Aspecto | Realidad | Evidencia |
|---|---|---|
| Backend desplegado | ❌ Sin evidencia de despliegue | No hay Dockerfile, docker-compose, PM2, CI/CD (sin `.github/`), ni configuración de hosting. Se ejecuta con `npm run dev`/`npm start` (`node server.js`), puerto 5000, BD en `localhost` (`.env.example`) |
| App publicada (Google Play / App Store) | ❌ NO | `app.json` **no define** `android.package` ni `ios.bundleIdentifier` (imprescindibles para publicar); no hay `eas.json` ni credenciales de build. La app solo corre con `expo start` / Expo Go / development build |
| URL del API | IP de red local `http://192.168.0.6:5000` | `Sport-Funcional/app.config.js:27-29` |
| Base de datos | Local (XAMPP: phpMyAdmin 5.2.1, 127.0.0.1) | Cabecera de `sport.sql` |
| Repositorios | GitHub (`Shamu9311/sport-back`, `Shamu9311/sport-front`) — solo alojamiento de código | `git remote -v` |

**Todo el sistema es, a día de hoy, un entorno de desarrollo/local.** No hay ningún componente en producción.

---

## 11. Seguridad y privacidad

### Medidas reales en código

- Hash de contraseñas con **bcryptjs** (costo 10) — `authController.js:46`.
- **JWT** con secreto por entorno (obligatorio en producción) y expiración de 7 días — `config/appConfig.js`, `authMiddleware.js`.
- **Helmet** (cabeceras seguras) — `server.js:13`.
- **CORS** configurable; abierto solo en desarrollo — `config/appConfig.js:22-40`.
- **Rate limiting** en tres niveles — `server.js`, `authRoutes.js`, `routes/recommendations.js`.
- **Consultas parametrizadas** en todos los modelos (anti SQL injection).
- **Autorización por propiedad** del recurso — `ownershipMiddleware.js`.
- Límite de cuerpo JSON de 100 kb; errores sin detalle en producción — `server.js:16`, `errorHandler.js`.
- Token guardado en **expo-secure-store** (almacenamiento cifrado del SO) en nativo — `tokenStorage.ts`.

### Datos personales almacenados

- Cuenta: username, email, hash de contraseña (`users`).
- Perfil (datos físicos y de salud percibida): edad, peso, altura, género, nivel de actividad, frecuencia, objetivo, sudoración, tolerancia a cafeína, restricciones dietéticas (`user_profiles`).
- Actividad: sesiones de entrenamiento con fechas, horas, deporte, clima y notas libres (`training_sessions`); feedback sobre productos; preferencias de notificación.
- El objeto usuario (username, email) se guarda **en texto plano en AsyncStorage** del dispositivo (`AuthContext.tsx:29-30`).

### Afirmaciones de seguridad que NO sería correcto hacer

- ❌ "Comunicación cifrada / HTTPS": el código usa HTTP plano contra una IP local; no hay TLS configurado en ninguna parte.
- ❌ "Cifrado de extremo a extremo" o "cifrado de datos en reposo": no existe.
- ❌ "Protección robusta contra fuerza bruta": solo hay rate limiting básico en memoria.
- ❌ "Gestión segura de sesiones con refresh tokens / revocación": no existe; el logout es solo local.
- ❌ "Cumple GDPR/LOPD" o cualquier afirmación de cumplimiento normativo: no hay consentimiento, ni borrado de cuenta, ni política de privacidad en el código.
- ⚠️ Además: el dump `sport.sql` con emails y hashes de 11 usuarios está **committeado en el repositorio** — un riesgo real que conviene corregir (y jamás presentar como buena práctica).

---

## 12. Resumen final para la tesis

### Tabla de contrastación

| Funcionalidad | Estado | Evidencia en código | Cómo debería describirse en una tesis |
|---|---|---|---|
| Registro e inicio de sesión | ✅ IMPLEMENTADO | `authController.js`, `app/login.tsx`, `app/register.tsx` | "Autenticación con email y contraseña, hash bcrypt y tokens JWT de 7 días" |
| Perfil detallado del deportista | ✅ IMPLEMENTADO | `app/create-profile.tsx`, `models/userModel.js:127-226` | "Perfil con 10 atributos físicos, de actividad y dietéticos almacenados en `user_profiles`" |
| Captura de alergias y suplementos preferidos | 🟡 PARCIAL | `create-profile.tsx:94-95` (se capturan, no se persisten) | No mencionarlo, o indicarlo como trabajo futuro |
| Catálogo de productos con búsqueda y filtros | ✅ IMPLEMENTADO | `app/(tabs)/products.tsx`, `routes/products.js`, `models/productModel.js` | "Catálogo de 50 productos con búsqueda, filtros por categoría/momento y detalle nutricional" |
| Registro de sesiones de entrenamiento | ✅ IMPLEMENTADO | `app/(tabs)/training.tsx`, `models/trainingSessionModel.js` | "CRUD de sesiones (crear, listar, ver, borrar; editar existe en API pero sin interfaz)" |
| Edición de sesiones | 🟡 PARCIAL | `PUT /api/training/:id` sin uso en UI | "La API soporta edición; la interfaz actual no la expone" |
| Recomendación con LLM | ✅ IMPLEMENTADO | `llmService.js`, `trainingRecommendationService.js` | "Recomendación de 4 productos por sesión usando GPT-3.5-Turbo (por defecto) o Gemini 2.5 Flash-Lite, con prompt aumentado por candidatos" |
| RAG con embeddings y búsqueda vectorial | 🟡 PARCIAL | `retrievalService.js`, `vectorSearchService.js`, `embeddingServices.js`, `USE_VECTOR_SEARCH=false` en `.env.example` | "Recuperación aumentada opcional: embeddings Gemini text-embedding-004 y similitud coseno en memoria; por defecto el sistema usa recuperación SQL heurística" |
| Fallback sin LLM | ✅ IMPLEMENTADO | `llmService.js:309-512` | "Mecanismo de respaldo determinista por reglas cuando el LLM no está disponible" |
| Feedback Bueno/Malo | 🟡 PARCIAL | `TrainingDetailModal.tsx:239-263`, `models/feedbackModel.js`, `retrievalService.js` | "El feedback negativo excluye productos de futuras recomendaciones; el positivo se registra pero aún no influye en el ranking" |
| Historial de recomendaciones y feedback | ✅ IMPLEMENTADO | `app/(tabs)/recommendations.tsx`, `GET /recommendations/saved`, `GET /recommendations/user-feedback` | "Historial clasificado por utilidad percibida" |
| Notificaciones | 🟡 PARCIAL | `notificationService.ts` | "Recordatorios locales programados en el dispositivo (sin push remoto)" |
| Seguridad (bcrypt, JWT, CORS, helmet, rate limit, SQL parametrizado) | ✅ IMPLEMENTADO | ver §7 y §11 | Describir exactamente esas medidas, sin añadir TLS/E2E |
| Pruebas automatizadas | ❌ NO IMPLEMENTADO | ver §8 | "Verificación manual mediante scripts; sin suite de pruebas" |
| Métricas del sistema | ❌ NO IMPLEMENTADO | ver §9 | No reportar métricas instrumentadas; solo mediciones externas ad-hoc si se hacen |
| Despliegue en producción / tiendas | ❌ NO IMPLEMENTADO | ver §10 | "Prototipo funcional en entorno local de desarrollo" |

### Funciones implementadas

- Registro/login con bcrypt + JWT; guardas de navegación por sesión y perfil.
- Wizard de perfil con 10 atributos persistidos y edición posterior.
- Catálogo con búsqueda, filtros, paginación y ficha completa de producto.
- Creación, listado, detalle y borrado de sesiones de entrenamiento.
- Generación asíncrona de 4 recomendaciones por sesión (LLM con prompt aumentado + fallback por reglas), con momento de consumo, cantidad e instrucciones.
- Persistencia de recomendaciones y polling desde la app.
- Feedback Bueno/Malo con exclusión de productos negativos en recomendaciones futuras.
- Historial de recomendaciones clasificado por feedback.
- Preferencias de notificación y recordatorios locales programados.
- Endurecimiento básico del API: helmet, CORS, rate limiting, SQL parametrizado, control de propiedad de recursos.

### Funciones parciales

- RAG vectorial (implementado pero desactivado por defecto; similitud calculada en memoria, sin BD vectorial).
- Feedback positivo (se almacena y muestra, pero no altera el ranking).
- Edición de sesiones y endpoints granulares de producto (API sin interfaz).
- Captura de alergias/suplementos preferidos (UI sin persistencia).
- Notificaciones (solo locales; sin push).
- Protección anti fuerza bruta (solo rate limit en memoria).

### Funciones no implementadas

- Pruebas automatizadas de cualquier tipo.
- Métricas instrumentadas (latencia, tasas, precisión).
- Despliegue en producción y publicación en tiendas.
- Fine-tuning, entrenamiento propio, RLHF, LangGraph.
- Redis, PM2, LogRocket, AWS, Vercel (ni cualquier infraestructura cloud).
- Google/Apple Sign-In, recuperación de contraseña, verificación de email, roles.
- Modo offline, cifrado E2E, HTTPS, refresh tokens, revocación de sesión.
- Precios de productos.

### Afirmaciones que NO deberían aparecer en la tesis

- "Sistema desplegado en la nube / disponible en Google Play o App Store".
- "Búsqueda vectorial en producción" (es opcional y está off por defecto; y no usa BD vectorial).
- "El sistema aprende del feedback del usuario" (solo excluye productos con feedback negativo; no hay aprendizaje).
- "Puntuación de confianza/score de las recomendaciones" (el score es aleatorio y ni siquiera se guarda).
- "Pruebas unitarias/de integración/de rendimiento realizadas".
- "Comunicación cifrada (HTTPS)", "cifrado de extremo a extremo", "protección avanzada contra fuerza bruta".
- "Métricas de latencia/precisión del sistema" (no están instrumentadas).
- "Entrenamiento o fine-tuning del modelo" (se consume API de terceros sin modificar).

### Descripción técnica breve y fiel

> La aplicación es un prototipo funcional de apoyo nutricional deportivo compuesto por una app móvil Expo/React Native y una API REST Node.js/Express sobre MariaDB 10.4.32, ejecutándose en entorno local. El usuario se registra (bcrypt + JWT), completa un perfil de 10 atributos físicos y dietéticos, explora un catálogo de 50 productos y registra sesiones de entrenamiento. Al crear una sesión, el backend genera de forma asíncrona 4 recomendaciones de productos (antes/durante/después/diario): selecciona ~20 candidatos mediante SQL heurístico (o, opcionalmente, similitud coseno sobre embeddings Gemini text-embedding-004), aumenta un prompt con el perfil, la sesión y los candidatos, y lo envía a GPT-3.5-Turbo (por defecto) o Gemini 2.5 Flash-Lite; si el LLM falla, aplica un fallback determinista por reglas. Las recomendaciones se persisten y la app las obtiene por polling. El usuario marca cada producto como Bueno/Malo; el feedback negativo excluye ese producto de futuras recomendaciones. La seguridad incluye bcrypt, JWT, helmet, CORS, rate limiting y SQL parametrizado. No hay pruebas automatizadas, métricas instrumentadas ni despliegue en producción.
