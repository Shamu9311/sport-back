Quiero implementar una suite REAL de pruebas para este proyecto de tesis.

Analiza completamente los dos repositorios:

- SportBack-funcionalBack
- Sport-Funcional

IMPORTANTE:

- NO cambies la lógica funcional de producción salvo que sea estrictamente necesario para permitir testabilidad.
- NO inventes pruebas ni resultados.
- NO uses la base de datos real/de desarrollo para pruebas destructivas.
- Crea una configuración de testing separada.
- No realices llamadas pagadas/reales a OpenAI o Gemini durante las pruebas automatizadas: utiliza mocks.
- La recuperación vectorial debe considerarse el flujo principal del sistema, usando USE_VECTOR_SEARCH=true en las pruebas correspondientes.
- Mantén también pruebas para el mecanismo alternativo SQL.
- Si una prueba no es técnicamente automatizable, indícalo claramente en el informe en lugar de simular que existe.

OBJETIVO:
Poder documentar en una tesis de pregrado pruebas unitarias, integración, rendimiento y seguridad que realmente existan y puedan volver a ejecutarse.

==================================================

1. # PRUEBAS UNITARIAS DEL BACKEND

Configura Jest o la herramienta más adecuada para el backend.

Implementa pruebas unitarias para:

A. Autenticación

- Registro válido.
- Email inválido.
- Email duplicado.
- Usuario duplicado.
- Hash de contraseña con bcryptjs.
- Login correcto.
- Contraseña incorrecta.
- Generación de JWT.
- Token inválido.
- Token expirado.

B. Perfil del deportista

- Creación de perfil válido.
- Actualización de perfil.
- Validación de edad.
- Manejo de datos incompletos.
- Restricciones dietéticas.

C. Sesiones de entrenamiento

- Creación de sesión.
- Validación de duración.
- Obtención de sesiones.
- Eliminación.
- Verificación de propiedad del recurso.

D. Sistema de recomendación
Separar y probar:

- Recuperación vectorial de candidatos.
- Generación del embedding del perfil mediante MOCK.
- Cálculo de similitud coseno.
- Ordenamiento de candidatos por similitud.
- Exclusión de productos con feedback negativo.
- Filtros de restricciones dietéticas.
- Filtros por tolerancia a cafeína.
- Construcción del prompt.
- Parsing de la respuesta del LLM usando un MOCK.
- Generación de exactamente 4 recomendaciones.
- Persistencia de recomendaciones.
- Mecanismo fallback basado en reglas cuando el LLM falla.

E. Recuperación SQL alternativa

- Selección de candidatos.
- Aplicación de restricciones.
- Exclusión por feedback negativo.
- Límite de candidatos.

F. Feedback

- Guardar feedback positivo.
- Guardar feedback negativo.
- Actualizar feedback existente.
- Verificar que un producto con feedback negativo sea excluido de futuras recomendaciones.

================================================== 2. PRUEBAS DE INTEGRACIÓN DEL BACKEND
==================================================

Utiliza Supertest o equivalente.

Configura una BASE DE DATOS DE TEST separada.

Nunca ejecutes estas pruebas sobre la base sport normal.

Implementa flujos completos:

FLUJO 1:
POST /api/auth/register
→ POST /api/auth/login
→ verificar JWT.

FLUJO 2:
login
→ crear perfil
→ consultar perfil
→ actualizar perfil.

FLUJO 3:
login
→ POST /api/training
→ generación de recomendaciones con LLM/embeddings MOCK
→ GET /api/training/:id/recommendations
→ comprobar que existan 4 recomendaciones.

FLUJO 4:
generar recomendaciones
→ enviar feedback Malo
→ crear otra sesión
→ comprobar que ese producto quede excluido.

FLUJO 5:
consultar catálogo
→ filtros
→ detalle completo de producto.

Comprobar también:

- respuestas HTTP correctas;
- JSON esperado;
- errores 400, 401, 403, 404 y 409 cuando correspondan.

================================================== 3. PRUEBAS DE SEGURIDAD
==================================================

Implementa pruebas automatizadas para lo que REALMENTE puede comprobarse:

- Endpoint protegido sin JWT → 401.
- JWT inválido → 401.
- Acceso a perfil de otro usuario → 403.
- Acceso a sesión de otro usuario → 403.
- Intentos repetidos de login → verificar rate limiting.
- Rate limiting del endpoint de recomendaciones.
- Payloads típicos de SQL Injection enviados como parámetros:
  ' OR 1=1 --
  '; DROP TABLE users; --
  etc.

Verificar que las consultas parametrizadas no permitan alterar las consultas SQL.

- CORS: comprobar comportamiento permitido/restringido según configuración.
- Verificar existencia de cabeceras Helmet.
- Verificar límite del body JSON.

NO afirmar que esto constituye una auditoría completa de ciberseguridad.
Debe documentarse solamente como "pruebas automatizadas de controles de seguridad implementados".

================================================== 4. PRUEBAS DEL FRONTEND
==================================================

El frontend ya tiene Jest/jest-expo instalado.

Agrega React Native Testing Library si es necesario.

Implementa pruebas para:

- Validación de formulario de login.
- Validación de registro.
- Validación de email.
- Validación de edad/peso/altura del perfil.
- Validación de duración de entrenamiento.
- Renderizado de estados de carga.
- Manejo de errores de API.
- Comportamiento básico de navegación según:
  sin sesión,
  sesión sin perfil,
  sesión con perfil.
- Renderizado de recomendaciones.
- Botones Bueno/Malo.
- Historial de recomendaciones.
- Preferencias de notificación.

Mockear axios, SecureStore y expo-notifications cuando sea necesario.

================================================== 5. PRUEBAS DE RENDIMIENTO
==================================================

Crear un script separado:

scripts/performanceTest.js

Debe medir el flujo REAL:

POST /api/training
→ obtener session_id
→ hacer polling a:
GET /api/training/:id/recommendations
→ detener cuando existan recomendaciones.

Registrar:

- tiempo total en milisegundos;
- mínimo;
- máximo;
- promedio;
- mediana;
- desviación estándar;
- cantidad de ejecuciones exitosas;
- cantidad de errores.

Debe permitir:

npm run test:performance

Configura inicialmente 20 ejecuciones secuenciales.

NO hagas llamadas reales al LLM en la prueba automatizada estándar.
Utiliza un mock con tiempo controlado.

Además crea una modalidad MANUAL opcional:

npm run test:performance:real

que pueda utilizar las APIs reales cuando el investigador quiera obtener las métricas finales de la tesis.

Nunca ejecutes automáticamente esa modalidad real.

Los resultados deben guardarse en:

test-results/performance-results.json
test-results/performance-results.csv

================================================== 6. PRUEBA DEL FLUJO VECTORIAL RAG
==================================================

Esto es especialmente importante.

Crear pruebas específicas con:

USE_VECTOR_SEARCH=true

Comprobar:

1. Se construye el texto/perfil usado para generar el embedding.
2. Se obtiene un embedding mock de 768 dimensiones.
3. Se recuperan embeddings de productos.
4. Se calcula similitud coseno.
5. Los productos quedan ordenados por similitud.
6. Se aplican filtros.
7. Se seleccionan candidatos.
8. Los candidatos se incorporan al prompt.
9. El LLM mock devuelve las recomendaciones.
10. Las recomendaciones se almacenan correctamente.

También implementar una prueba separada:

USE_VECTOR_SEARCH=false

para verificar la recuperación SQL alternativa.

================================================== 7. COBERTURA
==================================================

Configura:

npm run test:coverage

Generar cobertura de:

- statements
- branches
- functions
- lines

No fuerces artificialmente 100 %.

Reporta el porcentaje real obtenido.

================================================== 8. COMANDOS
==================================================

Quiero poder ejecutar, según corresponda:

Backend:
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run test:coverage
npm run test:performance

Frontend:
npm test
npm run test:coverage

Si la estructura actual requiere comandos distintos, crea scripts equivalentes y documenta cuáles son.

================================================== 9. BASE DE DATOS DE TEST
==================================================

Configura una BD independiente, por ejemplo:

sport_test

Debe:

- crear su estructura antes de las pruebas;
- utilizar datos ficticios;
- limpiarse entre pruebas cuando sea necesario;
- nunca utilizar emails/datos reales;
- nunca modificar sport.sql de producción/desarrollo accidentalmente.

================================================== 10. INFORME FINAL
==================================================

Cuando termines, crea:

TEST_IMPLEMENTATION_REPORT.md

Debe contener:

1. Herramientas instaladas.
2. Archivos creados/modificados.
3. Estructura de pruebas.
4. Pruebas unitarias implementadas.
5. Pruebas de integración implementadas.
6. Pruebas de frontend implementadas.
7. Pruebas de seguridad implementadas.
8. Pruebas de rendimiento implementadas.
9. Pruebas específicas del RAG vectorial.
10. Pruebas del fallback SQL.
11. Número TOTAL de tests.
12. Número de tests aprobados.
13. Número de tests fallidos.
14. Cobertura real.
15. Comandos exactos para reproducir cada prueba.
16. Qué cosas NO fueron probadas.
17. Qué afirmaciones serían correctas poner en una tesis.
18. Qué afirmaciones NO serían correctas poner.
19. Limitaciones de las pruebas.
20. Indicar claramente cuáles usan mocks y cuáles utilizan componentes reales.

Al final agrega una tabla:

| Tipo de prueba | Implementada | Nº tests | Resultado | Evidencia |
| -------------- | ------------ | -------: | --------- | --------- |

Y otra:

| Afirmación para la tesis | ¿Se puede afirmar? | Evidencia |
| ------------------------ | ------------------ | --------- |

IMPORTANTE FINAL:
Ejecuta realmente todas las pruebas automatizadas antes de terminar.
No escribas "prueba implementada" si no existe código ejecutable.
No escribas "prueba aprobada" si no fue ejecutada correctamente.
Si algo falla, déjalo documentado con la causa.
