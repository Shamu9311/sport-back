// services/llmService.js
import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Determinar el proveedor de LLM a utilizar
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai'; // Valor por defecto: OpenAI

// Variables para los clientes LLM
let openaiClient = null;
let geminiClient = null;
let geminiModel = null;

// Inicializar OpenAI si es el proveedor seleccionado o como respaldo
if (LLM_PROVIDER === 'openai' || LLM_PROVIDER === 'both') {
    const hasOpenAIKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '';
    
    if (hasOpenAIKey) {
        try {
            openaiClient = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
            console.log('OpenAI client initialized successfully');
        } catch (error) {
            console.error('Error initializing OpenAI client:', error);
        }
    } else {
        console.warn('OpenAI API key is missing or empty.');
    }
}

// Inicializar Gemini si es el proveedor seleccionado o como respaldo
if (LLM_PROVIDER === 'gemini' || LLM_PROVIDER === 'both') {
    const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '';
    
    if (hasGeminiKey) {
        try {
            geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            // Usando un modelo Gemini compatible con la API actual
            geminiModel = geminiClient.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
            console.log('Gemini client initialized successfully');
        } catch (error) {
            console.error('Error initializing Gemini client:', error);
        }
    } else {
        console.warn('Gemini API key is missing or empty.');
    }
}

// Verificar si tenemos al menos un proveedor de LLM disponible
const hasLLMProvider = openaiClient !== null || geminiModel !== null;

if (!hasLLMProvider) {
    console.warn('No LLM provider available. Using fallback recommendation system.');
}

// Función para ayudar a truncar texto si es muy largo
const truncateText = (text, maxLength = 200) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + "..." : text;
}

export const generateRecommendations = async (userProfile, candidateProducts, numRecommendations = 4) => {
    return getRecommendationsFromLLM(userProfile, candidateProducts, numRecommendations);
};

const MOCK_TIMINGS = ['antes', 'durante', 'despues', 'diario'];

function buildMockLLMResponse(userProfile, candidateProducts, numRecommendations = 4) {
    const selected = candidateProducts.slice(0, numRecommendations);
    const recommendations = selected.map((product, index) => ({
        product_id: product.product_id,
        reasoning: `Recomendación mock para ${product.name}`,
        consumption_timing: MOCK_TIMINGS[index] || 'durante',
        timing_minutes: index === 0 ? 30 : index === 2 ? 30 : null,
        interval_minutes: index === 1 ? 45 : null,
        quantity: '1 porción',
        instructions: 'Instrucciones mock de prueba',
    }));

    return {
        recommendations,
        llmReasoning: 'Respuesta mock para pruebas automatizadas',
        promptUsed: 'MOCK_LLM',
    };
}

export async function getRecommendationsFromLLM(userProfile, candidateProducts, numRecommendations = 4) {
    if (process.env.MOCK_LLM === 'true') {
        const delayMs = parseInt(process.env.MOCK_LLM_DELAY_MS || '300', 10);
        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (!userProfile) {
            throw new Error('User profile is required for LLM recommendation.');
        }
        if (!candidateProducts || candidateProducts.length === 0) {
            return { recommendations: [], llmReasoning: 'No se encontraron productos candidatos iniciales para evaluar.' };
        }
        return buildMockLLMResponse(userProfile, candidateProducts, numRecommendations);
    }

    // Si no hay ningún proveedor de LLM disponible, usamos el sistema de respaldo
    if (!hasLLMProvider) {
        console.log(`Using fallback recommendation system for user profile: ${userProfile.user_id}`);
        return getFallbackRecommendations(userProfile, candidateProducts, numRecommendations);
    }
    
    if (!userProfile) {
        throw new Error("User profile is required for LLM recommendation.");
    }
    if (!candidateProducts || candidateProducts.length === 0) {
        return { recommendations: [], llmReasoning: "No se encontraron productos candidatos iniciales para evaluar." };
    }
    
    // Seleccionar el proveedor de LLM según la configuración
    console.log(`Using ${LLM_PROVIDER} as LLM provider for recommendations.`);

    const profileString = `
        - Edad: ${userProfile.age || 'No especificada'}
        - Peso: ${userProfile.weight || 'No especificado'} kg
        - Altura: ${userProfile.height || 'No especificada'} cm
        - Género: ${userProfile.gender || 'No especificado'}
        - Nivel de Actividad: ${userProfile.activity_level || 'No especificado'}
        - Frecuencia de Entrenamiento: ${userProfile.training_frequency || 'No especificada'} veces/semana
        - Objetivo Principal: ${userProfile.primary_goal || 'No especificado'}
        - Nivel de Sudoración: ${userProfile.sweat_level || 'No especificado'}
        - Tolerancia a la Cafeína: ${userProfile.caffeine_tolerance || 'No especificada'}
        - Restricciones Dietéticas: ${userProfile.dietary_restrictions || 'Ninguna'}
    `.trim();

    const productsString = candidateProducts.map(p => `
        {
            "product_id": ${p.product_id},
            "name": "${p.name}",
            "category": "${p.category || ''}",
            "type": "${p.type || ''}",
            "usage_context": "${p.usage_context || ''}",
            "description": "${truncateText(p.description || '', 150)}",
            "usage_recommendation": "${truncateText(p.usage_recommendation || '', 100)}",
            "attributes": ${p.attributes ? `["${p.attributes.join('", "')}"]` : '[]'},
            "protein_g": ${p.protein_g || 0},
            "carbs_g": ${p.carbs_g || 0},
            "energy_kcal": ${p.energy_kcal || 0},
            "caffeine_mg": ${p.caffeine_mg || 0}
        }
    `).join(',\n');

    const systemPrompt = `
      Eres SportNutriBot, un asistente experto en nutrición deportiva. Tu tarea es analizar el perfil de un usuario 
      y una lista de productos de suplementación deportiva disponibles para recomendar los más idóneos.
      
      Instrucciones importantes:
      1. Siempre recomienda al menos un producto, incluso si no es una coincidencia perfecta.
      2. Si no hay productos que coincidan exactamente con el objetivo principal del usuario, 
         recomienda los que más se acerquen a sus necesidades generales.
      3. Considera el tipo de entrenamiento, duración e intensidad para ajustar las recomendaciones.
      4. Si hay restricciones dietéticas, asegúrate de que los productos recomendados sean compatibles.
      5. La tolerancia a la cafeína debe ser considerada para productos que la contengan.
      6. Si el usuario está en un entrenamiento de larga duración (>60 min), prioriza productos energéticos.
      7. Para entrenamientos de fuerza o hipertrofia, prioriza productos con proteína.
      8. IMPORTANTE: Los productos en la lista NO incluyen aquellos que el usuario ha marcado como "no funcionaron".
         Puedes recomendar libremente cualquier producto de la lista, ya que los productos con feedback negativo
         ya fueron filtrados previamente. Prioriza productos que el usuario haya evaluado positivamente si están disponibles.
      9. Cada producto incluye "usage_context" (pre entrenamiento, durante entrenamiento, post entrenamiento, diario).
         DEBES respetar ese campo al asignar consumption_timing. Solo recomienda un producto para una fase si su usage_context coincide.
    `;

    const userMessagePrompt = `
      Analiza el siguiente perfil de usuario:
      --- PERFIL DEL USUARIO ---
      ${profileString}
      --- FIN PERFIL DEL USUARIO ---

      Detalles del entrenamiento actual:
      - Tipo: ${userProfile.training_type || 'No especificado'}
      - Tipo de deporte: ${userProfile.sport_type || 'No especificado'}
      - Intensidad: ${userProfile.training_intensity || 'No especificada'}
      - Duración: ${userProfile.training_duration_min || 'No especificada'} minutos
      - Clima: ${userProfile.training_weather || 'No especificado'}
      - Notas: ${userProfile.training_notes || 'Ninguna'}

      Y la siguiente lista de productos disponibles:
      --- PRODUCTOS DISPONIBLES ---
      ${productsString}
      --- FIN PRODUCTOS DISPONIBLES ---

      IMPORTANTE: Recomienda EXACTAMENTE 4 productos siguiendo esta distribución de timing:
      1. UN producto para consumir ANTES del entrenamiento (15-30 minutos antes)
      2. UN producto para consumir DURANTE el entrenamiento
      3. UN producto para consumir DESPUÉS del entrenamiento (dentro de 30 minutos)
      4. UN producto de consumo DIARIO (vitaminas, suplementos base, bienestar general)
      
      REGLAS DE DISTRIBUCIÓN:
      - Cada producto debe tener un consumption_timing diferente: 'antes', 'durante', 'despues', 'diario'
      - Usa el campo "usage_context" de cada producto para elegir el timing correcto:
        * usage_context "pre entrenamiento" → consumption_timing "antes"
        * usage_context "durante entrenamiento" → consumption_timing "durante"
        * usage_context "post entrenamiento" → consumption_timing "despues"
        * usage_context "diario" → consumption_timing "diario"
      - Si para alguna fase NO hay producto con usage_context adecuado, OMITE esa fase: no inventes productos
        ni uses product_id null. Usa solo product_id que aparezcan en la lista.
      - Prioriza productos que naturalmente correspondan a cada fase:
        * ANTES: energía, pre-workout
        * DURANTE: geles, hidratación, electrolitos
        * DESPUÉS: recuperación, proteína
        * DIARIO: vitaminas, BCAA, suplementos de uso diario
      
      Para cada producto recomendado, proporciona:
      - 'product_id': ID numérico del producto
      - 'reasoning': Justificación específica del por qué es ideal para esta fase y este usuario
      - 'consumption_timing': 'antes', 'durante', 'despues' o 'diario' (uno distinto por producto)
      - 'timing_minutes': Minutos antes/después del entrenamiento (ej: 30). Para 'durante' y 'diario' puede ser null
      - 'interval_minutes': Solo para consumption_timing 'durante'. Cada cuántos minutos repetir consumo (ej: 30, 45). Obligatorio si es durante
      - 'quantity': Cantidad exacta a consumir
      - 'instructions': Instrucciones adicionales importantes

      Devuelve tu respuesta ÚNICAMENTE en formato JSON:
      {
        "recommendations": [
          { 
            "product_id": <ID_ENTERO>, 
            "reasoning": "Justificación...",
            "consumption_timing": "antes|durante|despues|diario",
            "timing_minutes": 30,
            "interval_minutes": 45,
            "quantity": "1 porción",
            "instructions": "Instrucciones específicas"
          }
        ],
        "llm_overall_reasoning": "Resumen de la estrategia de suplementación para este entrenamiento."
      }

      RECUERDA: Devuelve hasta 4 recomendaciones con consumption_timing distinto (antes, durante, despues, diario),
      una por fase que tenga un producto adecuado en la lista.
      No incluyas texto fuera del JSON. Solo el JSON.
    `;

    // Guardar el prompt exacto para debugging o auditoría
    const fullPromptForLog = `System: ${systemPrompt}\nUser: ${userMessagePrompt}`;
    // console.log("--- LLM PROMPT ---");
    // console.log(fullPromptForLog);
    // console.log("--- END LLM PROMPT ---");

    // Guarda variables para la respuesta del LLM
    let llmResponseContent;
    
    try {
        // Seleccionar el proveedor LLM basado en la configuración
        if (LLM_PROVIDER === 'openai' && openaiClient) {
            console.log('Making OpenAI API request...');
            const completion = await openaiClient.chat.completions.create({
                model: "gpt-3.5-turbo-0125", // O "gpt-4o", "gpt-4-turbo-preview", etc.
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessagePrompt }
                ],
                response_format: { type: "json_object" }, // Esto es clave para asegurar salida JSON con modelos compatibles
                temperature: 0.3, // Más bajo para respuestas más deterministas y factuales
                max_tokens: 1200,
            });
            llmResponseContent = completion.choices[0].message.content;
        } 
        else if (LLM_PROVIDER === 'gemini' && geminiModel) {
            console.log('Making Gemini API request...');
            // Construir el prompt para Gemini (combina system y user prompts)
            const geminiPrompt = `${systemPrompt}\n\n${userMessagePrompt}`;
            
            // generationConfig va dentro de la petición: como segundo argumento el SDK lo trataba como
            // RequestOptions y se ignoraban temperatura y límite. responseMimeType fuerza salida JSON.
            const result = await geminiModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: geminiPrompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                },
            });
            const response = await result.response;
            llmResponseContent = response.text();

            // Limpiar la respuesta si está envuelta en un bloque de código markdown
            if (llmResponseContent.includes('```')) {
                console.log('Respuesta de Gemini incluye formato markdown, limpiando...');
                llmResponseContent = llmResponseContent
                    .replace(/```(?:json)?\s*/g, '')
                    .trim();
            }
        }
        else {
            throw new Error(`Selected LLM provider (${LLM_PROVIDER}) not available or properly configured.`);
        }
        // console.log("--- LLM RAW RESPONSE ---");
        // console.log(llmResponseContent);
        // console.log("--- END LLM RAW RESPONSE ---");

        try {
            const parsedResponse = JSON.parse(llmResponseContent);
            console.log('Respuesta JSON parseada correctamente:', JSON.stringify(parsedResponse, null, 2));
            
            if (!parsedResponse.recommendations || !Array.isArray(parsedResponse.recommendations)) {
                 console.error("LLM response is not in the expected format (missing 'recommendations' array). Response:", llmResponseContent);
                 throw new Error("LLM response format error: 'recommendations' array is missing or not an array.");
            }
            
            console.log(`Número de recomendaciones encontradas: ${parsedResponse.recommendations.length}`);
            console.log('IDs de productos recomendados:', parsedResponse.recommendations.map(rec => rec.product_id));

            // Antes un solo ítem inválido (p. ej. product_id null porque "no hay producto diario")
            // descartaba TODA la respuesta. Ahora se descartan solo los ítems inválidos.
            const { valid, discarded } = sanitizeLLMRecommendations(parsedResponse.recommendations, candidateProducts);
            if (discarded.length > 0) {
                console.warn(`⚠️ LLM: ${discarded.length} recomendación(es) descartada(s):`, discarded.map((d) => d.reason).join('; '));
            }
            if (valid.length === 0) {
                throw new Error('LLM response had no valid recommendations.');
            }

            // Completar fases faltantes con el sistema de reglas (solo con productos de esa fase)
            const completed = completeMissingTimings(valid, userProfile, candidateProducts);
            return {
                recommendations: completed,
                llmReasoning: parsedResponse.llm_overall_reasoning || "Recomendaciones generadas.",
                promptUsed: fullPromptForLog // Guardar el prompt para auditoría/feedback
            };
        } catch (jsonError) {
            console.error("Error parsing LLM JSON response:", jsonError);
            console.error("LLM Response Content was:", llmResponseContent);
            throw new Error("Failed to parse LLM response as JSON.");
        }

    } catch (error) {
        console.error(`Error calling ${LLM_PROVIDER} API:`, error.response ? error.response.data : error.message);
        console.log("Using fallback recommendation system instead...");
        // Si falla la llamada al LLM, usamos el sistema de respaldo
        return getFallbackRecommendations(userProfile, candidateProducts, numRecommendations);
    }
}

// Sistema de recomendaciones de respaldo (simplificado sin LLM)
function mapUsageContextToTiming(usageContext) {
    if (!usageContext) return null;
    const ctx = String(usageContext).toLowerCase();
    if (ctx.includes('pre entrenamiento')) return 'antes';
    if (ctx.includes('durante entrenamiento')) return 'durante';
    if (ctx.includes('post entrenamiento')) return 'despues';
    if (ctx.includes('diario')) return 'diario';
    return null;
}

const VALID_TIMINGS = ['antes', 'durante', 'despues', 'diario'];

/**
 * Valida las recomendaciones del LLM contra los candidatos enviados: descarta ítems con product_id
 * inexistente/nulo, timing inválido, productos o fases repetidas. Devuelve válidas y descartadas.
 */
export function sanitizeLLMRecommendations(recommendations, candidateProducts) {
    const candidateIds = new Set((candidateProducts || []).map((p) => Number(p.product_id)));
    const usedProducts = new Set();
    const usedTimings = new Set();
    const valid = [];
    const discarded = [];

    for (const rec of recommendations || []) {
        const productId = typeof rec?.product_id === 'number' ? rec.product_id : parseInt(rec?.product_id, 10);
        const timing = typeof rec?.consumption_timing === 'string' ? rec.consumption_timing.toLowerCase().trim() : null;
        let reason = null;
        if (!Number.isInteger(productId)) reason = `product_id inválido (${rec?.product_id})`;
        else if (!candidateIds.has(productId)) reason = `product_id ${productId} no está entre los candidatos`;
        else if (!VALID_TIMINGS.includes(timing)) reason = `consumption_timing inválido (${rec?.consumption_timing})`;
        else if (usedProducts.has(productId)) reason = `producto ${productId} repetido`;
        else if (usedTimings.has(timing)) reason = `fase ${timing} repetida`;

        if (reason) {
            discarded.push({ rec, reason });
            continue;
        }
        usedProducts.add(productId);
        usedTimings.add(timing);
        valid.push({ ...rec, product_id: productId, consumption_timing: timing });
    }
    return { valid, discarded };
}

/**
 * Completa las fases que el LLM no cubrió usando el sistema de reglas, pero SOLO con productos cuyo
 * momento de uso corresponde a esa fase. Si no hay producto adecuado, la fase queda vacía.
 */
export function completeMissingTimings(validRecommendations, userProfile, candidateProducts) {
    const covered = new Set(validRecommendations.map((r) => r.consumption_timing));
    const missing = VALID_TIMINGS.filter((t) => !covered.has(t));
    if (missing.length === 0) return validRecommendations;

    const { recommendations: extra } = getFallbackRecommendations(userProfile, candidateProducts, missing.length, {
        timings: missing,
        excludeProductIds: validRecommendations.map((r) => r.product_id),
    });
    if (extra.length > 0) {
        console.log(`🧩 Fases completadas con reglas: ${extra.map((r) => r.consumption_timing).join(', ')}`);
    }
    const all = [...validRecommendations, ...extra];
    return all.sort((a, b) => VALID_TIMINGS.indexOf(a.consumption_timing) - VALID_TIMINGS.indexOf(b.consumption_timing));
}

function getFallbackRecommendations(userProfile, candidateProducts, numRecommendations = 4, options = {}) {
    const { timings = VALID_TIMINGS, excludeProductIds = [] } = options;
    console.log("Using fallback recommendation system for user profile:", userProfile.user_id);
    
    // Si no hay productos candidatos, devolver array vacío
    if (!candidateProducts || candidateProducts.length === 0) {
        return { 
            recommendations: [], 
            llmReasoning: "No se encontraron productos candidatos para recomendar.",
            promptUsed: "Sistema de respaldo (sin LLM)" 
        };
    }
    
    // Ordenar candidatos de acuerdo a criterios simples basados en el perfil
    let scoredProducts = candidateProducts.map(product => {
        let score = 0;
        
        // Puntaje basado en el objetivo primario del usuario
        if (userProfile.primary_goal) {
            const goal = userProfile.primary_goal.toLowerCase();
            
            if (goal.includes('musculo') || goal.includes('fuerza')) {
                // Priorizar productos con más proteína
                score += (product.protein_g || 0) * 2;
                if (String(product.category || '').toLowerCase().includes('proteina')) score += 10;
            }
            else if (goal.includes('rendimiento') || goal.includes('resistencia')) {
                // Priorizar productos con más carbohidratos para energía
                score += (product.carbs_g || 0) * 1.5;
                if (String(product.category || '').toLowerCase().includes('energia')) score += 10;
            }
            else if (goal.includes('perder') || goal.includes('peso')) {
                // Priorizar productos con menos calorías
                score += 500 - (product.energy_kcal || 0);
            }
        }
        
        // Restricciones absolutas: antes solo restaban puntaje (y el bono por carbohidratos podía
        // compensarlo); ahora excluyen el producto, igual que los filtros duros del retrieval.
        let excluded = false;

        // Verificar restricciones dietéticas
        if (userProfile.dietary_restrictions) {
            const restrictions = userProfile.dietary_restrictions.toLowerCase();
            const attributes = (product.attributes || []).map(a => a.toLowerCase());

            if (restrictions.includes('vegano') && !attributes.includes('vegano')) {
                excluded = true;
            }
            else if (restrictions.includes('vegetariano') &&
                    !attributes.includes('vegetariano') &&
                    !attributes.includes('vegano')) {
                excluded = true;
            }
        }

        // Verificar tolerancia a cafeína
        if (userProfile.caffeine_tolerance && product.caffeine_mg) {
            const tolerance = userProfile.caffeine_tolerance.toLowerCase();
            const caffeine = Number(product.caffeine_mg) || 0;

            if (tolerance === 'no' && caffeine > 0) {
                excluded = true;
            }
            else if (tolerance === 'bajo' && caffeine > 50) {
                excluded = true;
            }
        }

        return { ...product, score, excluded };
    });

    // Ordenar por puntaje (solo productos que cumplen las restricciones)
    scoredProducts = scoredProducts.filter((p) => !p.excluded);
    scoredProducts.sort((a, b) => b.score - a.score);

    // Distribuir productos por timing (antes, durante, después, diario)
    const timingNeeded = timings;
    const usedProductIds = new Set(excludeProductIds.map(Number));
    const assignedSlots = [];

    const getNaturalTiming = (product) => {
        const fromContext = mapUsageContextToTiming(product.usage_context);
        if (fromContext) return fromContext;

        const productName = (product.name || '').toLowerCase();

        if (productName.includes('rego') || productName.includes('recovery') || productName.includes('protein')) {
            return 'despues';
        }
        if (productName.includes('gel') || productName.includes('hydro') || productName.includes('electrolyte')) {
            return 'durante';
        }
        if (productName.includes('energy') || productName.includes('beta fuel')) {
            return 'antes';
        }
        if (productName.includes('vitamin') || productName.includes('bcaa') || productName.includes('immune')) {
            return 'diario';
        }
        return 'durante';
    };

    for (const timing of timingNeeded) {
        const suitableProduct = scoredProducts.find((p) => {
            if (usedProductIds.has(p.product_id)) return false;
            return getNaturalTiming(p) === timing;
        });

        if (suitableProduct) {
            usedProductIds.add(suitableProduct.product_id);
            assignedSlots.push({ product: suitableProduct, timing });
        }
    }

    // Ya NO se rellenan fases vacías con cualquier producto: eso asignaba, p. ej., un gel con cafeína
    // como "diario con el desayuno". Si una fase no tiene producto adecuado, queda sin recomendación.
    const missingTimings = timingNeeded.filter((t) => !assignedSlots.some((slot) => slot.timing === t));
    if (missingTimings.length > 0) {
        console.log(`ℹ️ Fallback: sin producto adecuado para ${missingTimings.join(', ')}`);
    }

    const finalRecommendations = assignedSlots.slice(0, numRecommendations).map(({ product, timing }) => {
        let reasoning = `Este producto es adecuado para tu perfil`;

        if (userProfile.primary_goal) {
            reasoning += ` y tu objetivo de ${userProfile.primary_goal}`;
        }

        if (product.protein_g && product.protein_g > 15) {
            reasoning += `. Alto contenido de proteínas (${product.protein_g}g).`;
        } else if (product.carbs_g && product.carbs_g > 20) {
            reasoning += `. Buena fuente de carbohidratos (${product.carbs_g}g).`;
        }

        const consumption_timing = timing;
        let timing_minutes = null;
        let interval_minutes = null;
        let quantity = '1 porción';
        let instructions = 'Seguir indicaciones del empaque';

        const productName = (product.name || '').toLowerCase();

        if (consumption_timing === 'antes') {
            timing_minutes = 30;
            if (productName.includes('energy') || productName.includes('bar')) {
                quantity = '1 barra o porción';
                instructions = 'Consumir 30 minutos antes para energía sostenida';
                reasoning += ' Ideal para preparar tu cuerpo antes del esfuerzo.';
            }
        } else if (consumption_timing === 'durante') {
            interval_minutes = productName.includes('gel') ? 45 : 30;
            if (productName.includes('gel')) {
                quantity = `1 gel cada ${interval_minutes} minutos`;
                instructions = 'Consumir con pequeños sorbos de agua si es necesario';
                reasoning += ' Proporciona energía rápida durante el ejercicio.';
            } else if (productName.includes('hydro') || productName.includes('electrolyte')) {
                interval_minutes = 20;
                quantity = '500ml durante el entrenamiento';
                instructions = 'Beber pequeños sorbos cada 15-20 minutos';
                reasoning += ' Mantiene tu hidratación óptima.';
            }
        } else if (consumption_timing === 'despues') {
            timing_minutes = 30;
            if (productName.includes('rego') || productName.includes('recovery')) {
                quantity = '1 porción (mezclar con 250ml agua)';
                instructions = 'Consumir dentro de los 30 minutos post-entrenamiento para mejor absorción';
                reasoning += ' Acelera tu recuperación muscular.';
            } else if (productName.includes('protein')) {
                quantity = '1 porción';
                instructions = 'Consumir dentro de 30 minutos para máxima síntesis proteica';
                reasoning += ' Favorece la reconstrucción muscular.';
            }
        } else if (consumption_timing === 'diario') {
            quantity = '1 porción diaria';
            instructions = 'Consumir a la misma hora cada día, preferiblemente con el desayuno';
            reasoning += ' Complementa tu nutrición diaria.';
        }

        return {
            product_id: product.product_id,
            reasoning,
            consumption_timing,
            timing_minutes,
            interval_minutes,
            quantity,
            instructions,
        };
    });

    console.log(`✅ Fallback: Generadas ${finalRecommendations.length} recomendaciones distribuidas por timing`);
    finalRecommendations.forEach((r) => {
        console.log(`   - ${r.consumption_timing.toUpperCase()}: Producto ${r.product_id}`);
    });

    return {
        recommendations: finalRecommendations,
        llmReasoning: 'Recomendaciones distribuidas en antes, durante, después y diario.',
        promptUsed: 'Sistema de respaldo (sin LLM)',
    };
}

export { getFallbackRecommendations };