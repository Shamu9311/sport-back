# Base de evidencia científica — contrato y guía de curación

> Estado: **preparación**. La capa no participa en las recomendaciones (`USE_EVIDENCE_RAG=false`).
> Esquema: migraciones `008_ingredients.sql`, `009_evidence_model_v2.sql` y `010_evidence_views_and_rls.sql`.

## 1. Estructura de carpetas

```
data/evidence/
  ingredients.json                     catálogo versionado de ingredientes (incluye carbohydrate y protein)
  formulations.json                    formulaciones (p. ej. maltodextrin_fructose_1_0_8)
  schema/evidence-manifest.v1.schema.json   contrato JSON (JSON Schema 2020-12, validado con ajv)
  examples/                            un manifiesto válido por tipo (SOLO para pruebas; prefijo "example-")
  sources/                             manifiestos reales curados (uno por fuente)
```

## 2. Flujo de trabajo

```bash
node scripts/normalizeIngredients.js --dry-run
node scripts/normalizeIngredients.js --confirm
node scripts/ingestEvidence.js data/evidence/sources/ --dry-run
node scripts/ingestEvidence.js data/evidence/sources/ --confirm
node scripts/generateEvidenceEmbeddings.js --confirm
node scripts/verifyIntegrity.js
```

1. **Normalizar los ingredientes del catálogo.** El `--dry-run` muestra qué se mapea y qué queda para revisión; `--confirm` lo escribe. Requiere la migración 008.
2. **Curar un manifiesto por fuente** en `sources/<source_key>.json`, con `review_status: "draft"`.
3. **Validar y simular la ingesta** con `--dry-run`: se valida todo y la transacción termina en ROLLBACK.
4. **Revisar el manifiesto** y pasarlo a `review_status: "reviewed"`, con `reviewed_by` y `reviewed_at`.
5. **Ingerir** con `--confirm`. Es idempotente y además genera los embeddings.
6. **Reintentar embeddings pendientes** con `generateEvidenceEmbeddings.js`, si alguno falló.
7. **Verificar la integridad** con `verifyIntegrity.js`.

Para escribir en la BD principal, los scripts exigen `--confirm`. Los manifiestos `example-*` solo se aceptan en la BD de test o con `--allow-examples`.

## 3. Contrato del manifiesto (v1.1)

| Bloque | Contenido |
|---|---|
| `schema_version` | `"1.0"` o `"1.1"` (v1.1 es compatible: los manifiestos 1.0 siguen siendo válidos) |
| `source` | Metadatos de la fuente. Obligatorios: `source_key`, `source_type`, `title` y al menos uno de `doi`, `pmid`, `url` |
| `chunks[]` | Fragmentos curados: `chunk_key`, `section`, `content`; opcionales `heading`, `page`, `paragraph`, `content_kind` |
| `claims[]` | Afirmaciones estructuradas: `claim_key`, `claim_type`, `effect_direction`, `result_summary`, más los campos que la fuente informe |
| `product_relations[]` | Producto ↔ evidencia con `relation_type` y `rationale` obligatoria |
| `product_ingredients[]` | Composición declarada; **solo** en `manufacturer_specification` del propio producto |

Reglas clave:
- **No inventar.** Un campo que la fuente no informa se **omite**.
- Todas las referencias usan **claves naturales**: código de ingrediente o formulación, `product_id` del catálogo, `chunk_key`, `claim_key`.
- La identidad de una fuente es `source_key`. DOI y PMID son únicos entre fuentes; una fuente sin DOI (consensos, AIS, páginas oficiales) es válida con URL.
- El manifiesto es la fuente de verdad **de su fuente**: los chunks, claims o relaciones que se quiten del archivo se eliminan al volver a ingerir.

### 3.1 Tipos y categorías de fuente

`source_category` se deriva de `source_type` y no se puede editar:

| `source_category` | `source_type` |
|---|---|
| `scientific_evidence` | `meta_analysis`, `systematic_review`, `randomized_controlled_trial`, `crossover_trial`, `non_randomized_trial`, `observational_study`, `narrative_review`, `other` |
| `official_guideline` | `consensus`, `position_stand`, `guideline`, `official_framework` |
| `manufacturer_specification` | `manufacturer_specification` |

Una **especificación del fabricante** es válida para composición, cantidades, ingredientes, información nutricional e instrucciones oficiales. **Nunca es evidencia independiente de eficacia.**
- Solo admite claims `composition` y `usage_instruction`; lo exigen el schema, un trigger y `verifyIntegrity`.
- Su `evidence_level` puede quedar **vacío**, incluso cuando está `reviewed`.

### 3.1.1 Sujeto del claim (v1.1)

Cada claim se refiere a un **sujeto**: `ingredient`, `formulation` o `product_id`. Excepciones:

| `claim_type` | ¿Puede no tener sujeto? |
|---|---|
| `dosage_guideline`, `timing_guideline` | Sí (guías generales) |
| `usage_instruction` | **Solo** si la fuente es `scientific_evidence` u `official_guideline`: orientaciones prácticas generales (p. ej. *food-first*, evaluación individual antes de suplementar) |
| `usage_instruction` en `manufacturer_specification` | **No**: exige `product_id` y/o `ingredient` (una formulación sola no basta) |
| `efficacy`, `safety`, `mechanism`, `composition` | No |

Lo aplican el JSON Schema, las reglas de `evidenceManifest.js`, el CHECK `evidence_claims_subject` + el trigger `evidence_claims_rules` (migración 011) y `verifyIntegrity`. Un `usage_instruction` general no evalúa efectos (`effect_direction: not_applicable`) y no justifica momentos de consumo.

### 3.2 `effect_direction`

| Valor | Uso |
|---|---|
| `positive` / `negative` | Efecto favorable / desfavorable reportado |
| `neutral` | Se evaluó y **no hubo diferencia**. La falta de significancia nunca se registra como `negative` (regla validada) |
| `mixed` | Resultados contradictorios |
| `insufficient` | Se evaluó o discutió una cuestión científica, pero la evidencia es insuficiente |
| `not_applicable` | **Obligatorio** en `composition` y `usage_instruction`, y **prohibido** en cualquier otro tipo de claim |

### 3.3 Timing (`timing_context[]`)

Valores posibles: `pre`, `during`, `post`, `daily_chronic`, `flexible`, `not_specified`. Un claim puede tener varios (`["pre","during"]`); `not_specified` no se combina con otros.

`timing_evidence_strength` mide cuánto respalda la fuente **el momento**:
- **`strong`:** la fuente compara directamente distintos momentos.
- **`moderate`:** el momento forma parte del protocolo eficaz, pero no se comparó con otros.
- **`limited`:** el momento se infiere o el respaldo es débil.
- **`not_assessed`:** el momento no se evaluó (valor por defecto).

**Regla para la fase siguiente** (documentada; la aplica la vista `v_claim_timing_support`, pero ningún servicio la usa todavía):
- **`strong` y `moderate` pueden justificar un momento de consumo.** Además deben cumplirse todas estas condiciones: claim y fuente `reviewed`, fuente que no sea del fabricante, claim de eficacia o guía, resultado `positive` o `mixed` y un momento concreto (`pre`, `during`, `post` o `daily_chronic`).
- **`limited` y `not_assessed` se conservan para trazabilidad, pero no hacen elegible ningún momento.**
- **`flexible` y `not_specified` no generan un momento.**
- **`daily_chronic` nunca se deriva de que un producto pertenezca a una categoría "diario".** Solo puede salir de un claim revisado con respaldo suficiente para consumo crónico; la vista no consulta `product_categories`.
- Las instrucciones del fabricante pueden informar la dosis o la forma de uso, pero no crean elegibilidad.

### 3.4 Relaciones producto ↔ evidencia (grado de indirección)

| `relation_type` | Significado | Requisito |
|---|---|---|
| `direct_product` | La fuente estudió **ese producto** | Claim `product_specific` del mismo producto; no puede ser del fabricante |
| `formulation` | La fuente estudió la formulación que el producto declara | El producto tiene esa formulación (`product_formulations`) |
| `ingredient` | La fuente estudió un ingrediente que el producto contiene | `product_ingredients` contiene el ingrediente |
| `category` | Guía general sobre una categoría de suplementos | El producto pertenece a la categoría |
| `manufacturer_specification` | Ficha oficial del producto | La fuente es del fabricante |

Evidencia sobre un ingrediente **no demuestra** la eficacia de un producto que lo contiene: la relación conserva su grado de indirección. La vista `v_product_evidence_derived` combina relaciones explícitas y derivadas con `indirection_rank` (1 = estudio del producto … 5 = fabricante).

## 4. Niveles de evidencia (escala operativa de esta investigación)

> Clasificación **operativa propia** de esta tesis. **No es GRADE** ni una escala clínica estandarizada.
> Se guardan tres dimensiones separadas: `evidence_level` (calidad de la fuente), `evidence_strength` (fuerza del claim) y `timing_evidence_strength` (respaldo del momento).

| Nivel | Criterio base | Código |
|---|---|---|
| **A** | Meta-análisis o revisión sistemática con búsqueda explícita y reproducible que incluye ≥ 2 ECA | A1 |
| | Consenso, posición o guía de un organismo reconocido (ISSN, IOC, ACSM, AIS, EFSA, autoridad sanitaria) con método de revisión declarado | A2 |
| **B** | ECA o cruzado aleatorizado y controlado (placebo o comparador), revisado por pares, con `n` reportado | B1 |
| | Revisión sistemática que solo incluye estudios no aleatorizados | B2 |
| **C** | Ensayos no aleatorizados, estudios observacionales o revisiones narrativas | C1 |
| | Fuente A o B degradada (ver abajo) | C2 |
| **D** | Opinión de expertos, documentos no revisados por pares, resúmenes de congreso, evidencia insuficiente | D2 |
| (vacío o D) | Especificación del fabricante: no se clasifica como evidencia de eficacia | D1 |

**Degradaciones:** un nivel cada una, acumulables y como mínimo hasta C para fuentes científicas. Se registran en `evidence_level_rationale`.
1. **Riesgo de sesgo alto:** sin aleatorización o cegamiento cuando aplica, pérdidas > 20 % o análisis inadecuado.
2. **Imprecisión:** `n < 10` en total en un ECA o cruzado, o intervalos muy amplios declarados.
3. **Indirección:** población no deportista, dosis o forma distinta, o un resultado sustituto lejano del rendimiento.

**No degradan:**
- La financiación de la industria o los conflictos de interés: se registran en `funding`, `industry_funded`, `conflict_of_interest` y `conflict_of_interest_notes`, pero no invalidan el estudio.
- La dirección del resultado: los estudios neutros y negativos se conservan con el mismo criterio de calidad.

`evidence_strength` (claim) puede ser **menor** que el nivel de la fuente, por ejemplo en un subanálisis o un resultado secundario.

## 5. Chunking y licencias

- Los fragmentos llegan **curados**, con sección, encabezado y página. El script no extrae PDFs.
- **Unidades de significado:**
  - abstract;
  - métodos relevantes (participantes, dosis, timing, protocolo);
  - resultados por apartado;
  - discusión o conclusión por idea;
  - cada enunciado de una guía;
  - tablas serializadas a texto;
  - en fichas del fabricante, composición e instrucciones por separado.
- Un fragmento de más de unos 600 tokens se divide **por párrafos** dentro del mismo encabezado. Las claves resultantes son `chunk_key.1`, `.2`, y se conserva la procedencia.
- `content_hash` es el sha256 del contenido normalizado (NFC, espacios colapsados). Si cambia, el embedding se regenera.
- **`content_kind`:** `verbatim` (literal), `excerpt` (extracto breve) u `own_summary` (resumen propio).
- **Fuentes sin licencia abierta:** solo metadatos, abstract cuando pueda almacenarse legítimamente, extractos breves y resúmenes propios. **Nunca el texto completo.** La validación rechaza texto `verbatim` fuera del abstract cuando `open_access: false`.

## 6. Embeddings

- Se usa `gemini-embedding-001`, `outputDimensionality: 768`, `taskType: RETRIEVAL_DOCUMENT`.
- Solo se generan los chunks sin vector, con contenido cambiado o con un vector de otro modelo; se valida dimensión 768 y norma > 0.
- Las fuentes `retired` se omiten.
- La búsqueda usa `<=>` con índice HNSW y la vista `v_retrievable_evidence_chunks`, que solo incluye `reviewed`.

## 7. Evidence RAG en el recomendador (`USE_EVIDENCE_RAG=true`)

Con `USE_EVIDENCE_RAG=false` (valor por defecto) el recomendador sigue usando el flujo anterior sin cambios.
Con `true` se usa este flujo (`services/evidenceRecommendationService.js`):

```
perfil + sesión → productos candidatos → ingredientes/formulaciones
  → elegibilidad (claims revisados) → similitud pgvector (chunks revisados) → ranking
  → contexto con refs (P/C/S/K) → Gemini (o respaldo determinista) → validación → recommendation_evidence
```

### 7.1 Orden de decisión (`services/evidenceEligibilityService.js`)

1. **Claim científico o de guía `reviewed`** (fuente `reviewed`, no fabricante): habilita nutriente + momento + condiciones. Solo `strong`/`moderate` (vista `v_claim_timing_support`); `limited` y `not_assessed` no habilitan.
2. **Rol funcional compatible** (`product_type_functional_roles` + `functional_role_nutrients`, versión `v1.0`, por `product_type`): `fueling`, `hydration`, `recovery`, `no_fueling`. Restringe; nunca habilita.
3. **Cantidad útil**: la dosis sale del propio claim (o, si no la declara, del claim con dosis del mismo sujeto y fuente).
   - Carbohidrato durante (g/h): `porciones/h = objetivo ÷ g por porción`; 30–60 g/h (1–2.5 h) y hasta 90 g/h (>150 min) solo con formulación de varios carbohidratos.
   - Cafeína (mg/kg del usuario): 3–6 mg/kg banda **principal**; 2–<3 mg/kg banda **contextual** (claim `caffeine-minimal-effective-dose`, nivel C, incierto). Por encima de 6 mg/kg no se propone aumentar y se avisa.
   - Proteína: ≥20 g por toma. Sodio: ≥500 mg/L de bebida, con las condiciones estructuradas del claim.
4. **Ficha oficial revisada del fabricante**: confirma o restringe forma y frecuencia (`usage_instruction` con `dose_unit` = `servings_per_hour` / `servings_per_day`). Nunca demuestra eficacia.
5. **Ranking**: nivel × relación × fuerza del timing × dirección × condiciones × similitud; resta la evidencia neutral/insuficiente; `cadence_unverified` pesa menos.

### 7.2 Cadencia

| Estado | Qué permite |
|---|---|
| `cadence_verified` | Tasas por hora y varias porciones dentro del máximo de la ficha revisada |
| `cadence_unverified` | **Una sola porción** que cumpla por sí sola la dosis; nunca porciones/h, repeticiones de cafeína ni `daily_chronic` |

No se heredan instrucciones entre sabores o variantes salvo que la propia fuente oficial lo declare.

### 7.3 Huecos (fase + función) y número de recomendaciones

Cada par elegible se asigna a un **hueco** = fase + función neutra, derivada del nutriente y del momento (no del tipo de producto):

| Nutriente | Momento | Función |
|---|---|---|
| carbohydrate | antes, durante (y después) | `fueling` |
| protein | antes, después | `protein_support` |
| sodium | cualquiera | `hydration` |
| caffeine | cualquiera | `caffeine` |
| cualquiera | `daily_chronic` | `supplementation` |

- **1 principal por hueco**, elegido de forma determinista **antes** del LLM. Orden: banda principal > contextual; nivel de evidencia; relación (producto > formulación > ingrediente); `cadence_verified`; parte del objetivo alcanzable con la cadencia oficial; menos porciones; condiciones estructuradas; cubrir también la cafeína (o no aportar cafeína no buscada); feedback positivo; puntuación (la similitud vectorial solo entra aquí, al final). Las restricciones dietéticas y el feedback negativo excluyen antes.
- **Hasta 2 alternativas** del mismo hueco ("en lugar de, no además"), con el motivo de no ser la principal. No cuentan en el máximo y Gemini no puede cambiarlas por la principal.
- **Un producto que cubre varias funciones** de su fase ocupa todos esos huecos como una sola recomendación (`also_covers`).
- **Repetición:** el mismo producto se repite según porciones/h = objetivo del claim ÷ gramos por porción; nunca se obliga a variar. Un producto puede aparecer en fases distintas, nunca dos veces en la misma.
- **Cafeína acumulada:** se suman todas las porciones de todos los principales y fases. El máximo es el de los claims revisados aplicables a los momentos en que se consume (sin frontera fija). Si el plan necesario lo supera, el producto se descarta (y no aparece como alternativa); si solo lo supera el extremo alto, se limitan las porciones/h. Si la cafeína ya alcanza la banda, no se añade otro producto cafeinado. Un producto cafeinado con carbohidrato cuenta dentro del objetivo de carbohidrato y sustituye porciones del principal.
- Sin mínimo y sin relleno de fases. Máximo 5 principales. `daily_chronic` nunca se deriva de la categoría del producto.

### 7.4 Trazabilidad

- `recommendation_evidence`: `recommendation_id`, `source_id`, `claim_id`, `chunk_id`, `relation_type`, `role` (`supports`, `caveat`, `dose_reference`, `usage_constraint`), `similarity`, `score`, `rank`. Un trigger impide registrar al fabricante como respaldo (solo `usage_constraint`).
- `recommendations.evidence_mode` (`legacy` / `evidence_rag`), `cadence_status`, `evidence_note`.
- `recommendations.functional_role`, `also_covers`, `target` (objetivo del claim) y `usage_plan` (plan del servidor); `recommendation_alternatives` (migración 016).
- `training_sessions.recommendation_status` (`pending`, `ready`, `none`, `failed`) permite al frontend distinguir "generando" de "sin evidencia suficiente".
- La API devuelve en cada recomendación `evidence[]` (título, año, tipo, resumen, DOI/URL, rol), sin similitud ni datos técnicos.

### 7.5 Contrato v1.2 (condiciones) — propuesto, pendiente de validación

- `conditions.sweat_loss`: `low` / `moderate` / `high`, que se compara con `user_profiles.sweat_level` (`bajo`/`medio`/`alto`).
- `conditions.any_of`: lista de ≥2 disparadores; basta con que se cumpla uno (p. ej. `heat` **o** `sweat_loss: high`). El resto de condiciones del objeto sigue siendo obligatorio.
- Usar `sweat_loss` o `any_of` exige `schema_version: "1.2"`.
- Las pérdidas elevadas de sodio por sudor ("salty sweat") no se pueden estructurar: el perfil no tiene ese dato.
- Las dosis en concentración (mg/L) se tratan como **rango**: por encima del máximo del claim no hay respaldo, salvo otro claim revisado o una preparación oficial que permita diluir (aún no estructurada en el contrato).

### 7.6 Pendientes antes de activar `USE_EVIDENCE_RAG=true`

1. **Revisar las fichas del fabricante del Batch 2 (`draft`)**, en especial las que aportan cadencia (25: 1–3/h; 17: 1/h; 5: 1/día). Mientras sigan en `draft`, ningún producto tiene `cadence_verified` y el carbohidrato "durante" no puede recomendarse.
2. **Recuperación híbrida de candidatos.** Hoy Evidence RAG evalúa solo el top-20 vectorial, y un producto estructuralmente elegible (p. ej. el 25) puede quedar fuera. Propuesta:
   - candidatos = top-K vectorial ∪ productos **estructuralmente elegibles**: tipo con rol compatible y que contengan (con cantidad declarada) un nutriente o formulación habilitado por algún claim revisado para los momentos posibles de la sesión;
   - los mismos filtros duros que hoy (activos, restricciones dietéticas, tolerancia a cafeína, feedback negativo);
   - la similitud vectorial solo ordena; no decide qué productos se evalúan;
   - límite por rendimiento sobre el conjunto estructural (≈50 productos activos: sin coste apreciable).
3. **Ingerir la condición v1.2 del claim de sodio AIS** solo tras validarla (calor **o** sudoración alta).
4. **Concentraciones de sodio fuera de rango.** Ninguna bebida actual queda en 500–700 mg/L (GO Electrolyte 1000; HYDRO 1740 con el dato pendiente del producto 36). No se dan como respaldadas.
