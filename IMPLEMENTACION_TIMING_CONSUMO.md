# 📋 Implementación de Timing de Consumo de Productos

## ✅ Cambios Realizados

### 1. Base de Datos

**Archivo:** `add_consumption_timing.sql`

**Nuevas columnas en tabla `recommendations`:**

- `consumption_timing` ENUM('antes', 'durante', 'despues', 'diario')
- `timing_minutes` INT - Minutos antes/después del entrenamiento
- `recommended_quantity` VARCHAR(100) - Cantidad recomendada
- `consumption_instructions` TEXT - Instrucciones adicionales

**Cómo ejecutar:**

```sql
mysql -u root -p sport < add_consumption_timing.sql
```

O desde phpMyAdmin/MySQL Workbench, ejecutar el contenido del archivo.

---

### 2. Backend - Servicio LLM

**Archivo:** `services/llmService.js`

**Cambios en el prompt (líneas 156-161):**

```javascript
{
  "product_id": <ID>,
  "reasoning": "...",
  "consumption_timing": "antes|durante|despues",  // NUEVO
  "timing_minutes": 15,  // NUEVO
  "quantity": "1 gel cada 30 minutos",  // NUEVO
  "instructions": "No requiere agua"  // NUEVO
}
```

**Sistema de respaldo mejorado (líneas 353-400):**

- Genera timing basado en el nombre del producto
- Reglas inteligentes:
  - Productos con "gel" → durante
  - Productos con "hydro" → durante
  - Productos con "recovery"/"protein" → después (30 min)
  - Vitaminas/BCAA → diario

---

### 3. Backend - Modelo de Recomendaciones

**Archivo:** `models/recommendationModel.js`

**Cambios en `createRecommendation` (línea 32):**

- Acepta nuevos parámetros: `consumption_timing`, `consumption_instructions`, `recommended_quantity`, `timing_minutes`
- Los guarda en la base de datos (líneas 48-51)

**Cambios en queries SELECT:**

- `getPersonalized` (líneas 8-24) - Incluye nuevos campos
- `getByTrainingSession` (líneas 28-43) - Incluye nuevos campos

---

### 4. Backend - Servicio de Entrenamientos

**Archivo:** `services/trainingRecommendationService.js`

**Cambios (líneas 87-97):**

- Pasa los nuevos campos del LLM al crear recomendaciones
- Log mejorado mostrando el timing

---

### 5. Frontend - Modal de Detalles

**Archivo:** `src/components/TrainingDetailModal.tsx`

**Nueva sección "Cómo Consumir" (líneas 232-279):**

- Muestra cuándo consumir (con icono de color)
- Muestra cantidad recomendada
- Muestra instrucciones específicas
- Diseño tipo card con borde amarillo

**Iconos y colores por timing:**

- 🟢 Antes: Verde (#4CAF50)
- 🟡 Durante: Amarillo (#FFC107)
- 🔵 Después: Azul (#2196F3)
- 🟣 Diario: Morado (#9C27B0)

**Nuevos estilos (líneas 661-708):**

- `consumptionGuide` - Card principal
- `consumptionHeader` - Header con icono
- `consumptionItem` - Cada item de información
- `consumptionLabel` - Label en mayúsculas
- `consumptionValue` - Valor destacado

---

## 🎯 Resultado Visual

### Antes:

```
┌─────────────────────────────┐
│ HYDRO Tablet                │
│ [imagen]                    │
│ 💡 Recomendado porque...    │
└─────────────────────────────┘
```

### Ahora:

```
┌─────────────────────────────┐
│ HYDRO Tablet                │
│ [imagen]                    │
│ 💡 Recomendado porque...    │
│                             │
│ ┌─ Cómo Consumir ─────────┐ │
│ │ 🍽️ CUÁNDO              │ │
│ │ Durante del entrenamiento│ │
│ │                          │ │
│ │ ⚗️ CANTIDAD              │ │
│ │ 500ml durante entrenami  │ │
│ │                          │ │
│ │ ℹ️ INSTRUCCIONES         │ │
│ │ Beber pequeños sorbos... │ │
│ └──────────────────────────┘ │
└─────────────────────────────┘
```

---

## 🧪 Cómo Probar

### 1. Actualizar Base de Datos

```bash
cd SportBack-funcionalBack
mysql -u root -p sport < add_consumption_timing.sql
```

### 2. Reiniciar Backend

```bash
npm run dev
```

### 3. Probar en la App

1. Crear un nuevo entrenamiento
2. Las recomendaciones se generarán automáticamente con timing
3. Abrir detalles del entrenamiento
4. Ver la nueva sección "Cómo Consumir"

---

## 📊 Datos de Ejemplo

El LLM ahora genera respuestas como:

```json
{
  "recommendations": [
    {
      "product_id": 1,
      "reasoning": "GO Energy Isotonic Gel ideal para tu cardio de 45 min de intensidad media",
      "consumption_timing": "durante",
      "timing_minutes": null,
      "quantity": "1 gel cada 30 minutos",
      "instructions": "No requiere agua, es isotónico"
    },
    {
      "product_id": 11,
      "reasoning": "REGO Rapid Recovery perfecto para recuperación post-cardio",
      "consumption_timing": "despues",
      "timing_minutes": 30,
      "quantity": "1 porción (20g proteína)",
      "instructions": "Mezclar con 250ml de agua inmediatamente después del ejercicio"
    }
  ]
}
```

---

## ⚠️ Notas Importantes

1. **Compatibilidad:** Las recomendaciones antiguas (sin timing) seguirán funcionando
2. **Fallback:** Si el LLM falla, el sistema de respaldo genera timing automáticamente
3. **Validación:** El timing solo se muestra si existe en la BD
4. **Colores:** Cada tipo de timing tiene su color distintivo para mejor UX

---

## 🔄 Próximos Pasos Sugeridos

1. ✅ Ejecutar script SQL (HECHO)
2. ✅ Actualizar backend (HECHO)
3. ✅ Actualizar frontend (HECHO)
4. ⏳ Probar con datos reales
5. ⏳ Ajustar prompts del LLM según resultados
6. ⏳ Implementar persistencia de sesión (AsyncStorage)

---

**Fecha de implementación:** 15 de Octubre, 2025
