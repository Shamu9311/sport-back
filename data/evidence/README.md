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

## 3. Contrato del manifiesto (v1)

| Bloque | Contenido |
|---|---|
| `schema_version` | `"1.0"` |
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

## 7. Trazabilidad y fase siguiente

- Cada claim y cada chunk referencian su fuente (DOI, PMID, URL). `getProvenance()` lo devuelve.
- Cada ingesta con `--confirm` queda registrada en `evidence_ingest_runs` (hash del archivo, resumen y errores).
- **Previsto para la fase siguiente, todavía no creado:**
  - `recommendation_runs`: modelo, versión, duración, flag de evidencia, uso del sistema de reglas, candidatos y evidencia recuperada;
  - `recommendation_evidence`: `recommendation_id`, `source_id`, `chunk_id`, `claim_id`, `similarity`, `rank`, `cited`.
- **Flujo futuro:**

  ```
  perfil + entrenamiento → candidatos → ingredientes/formulaciones → evidencia
    → chunks + claims → ranking por similitud × calidad → Gemini
  ```

  La recuperación ocurre **después** de conocer los candidatos, sobre una base curada.
