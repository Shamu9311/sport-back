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

export const generateRecommendations = async (userProfile, candidateProducts, numRecommendations = 3) => {
    return getRecommendationsFromLLM(userProfile, candidateProducts, numRecommendations);
};

export async function getRecommendationsFromLLM(userProfile, candidateProducts, numRecommendations = 3) {
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
    `;

    const userMessagePrompt = `
      Analiza el siguiente perfil de usuario:
      --- PERFIL DEL USUARIO ---
      ${profileString}
      --- FIN PERFIL DEL USUARIO ---

      Detalles del entrenamiento actual:
      - Tipo: ${userProfile.training_type || 'No especificado'}
      - Intensidad: ${userProfile.training_intensity || 'No especificada'}
      - Duración: ${userProfile.training_duration_min || 'No especificada'} minutos
      - Clima: ${userProfile.training_weather || 'No especificado'}
      - Notas: ${userProfile.training_notes || 'Ninguna'}

      Y la siguiente lista de productos disponibles:
      --- PRODUCTOS DISPONIBLES ---
      ${productsString}
      --- FIN PRODUCTOS DISPONIBLES ---

      IMPORTANTE: Recomienda EXACTAMENTE 3 productos siguiendo esta distribución de timing:
      1. UN producto para consumir ANTES del entrenamiento (15-30 minutos antes)
      2. UN producto para consumir DURANTE el entrenamiento
      3. UN producto para consumir DESPUÉS del entrenamiento (dentro de 30 minutos)
      
      REGLAS DE DISTRIBUCIÓN:
      - Cada producto debe tener un consumption_timing diferente ('antes', 'durante', 'despues')
      - Si para alguna fase NO existe un producto ideal, selecciona el más cercano o útil
      - Si definitivamente no hay un producto adecuado para una fase específica, omite esa recomendación
      - Prioriza productos que naturalmente correspondan a cada fase según su categoría:
        * ANTES: Productos de energía, pre-workout
        * DURANTE: Geles, hidratación, electrolitos
        * DESPUÉS: Recuperación, proteína
      
      Para cada producto recomendado, proporciona:
      - 'product_id': ID numérico del producto
      - 'reasoning': Justificación específica del por qué es ideal para esta fase y este usuario
      - 'consumption_timing': 'antes', 'durante' o 'despues' (debe ser diferente para cada producto)
      - 'timing_minutes': Minutos específicos antes/después (ej: 30 para antes, 30 para después)
      - 'quantity': Cantidad exacta a consumir
      - 'instructions': Instrucciones adicionales importantes

      Devuelve tu respuesta ÚNICAMENTE en formato JSON:
      {
        "recommendations": [
          { 
            "product_id": <ID_ENTERO>, 
            "reasoning": "Justificación...",
            "consumption_timing": "antes|durante|despues",
            "timing_minutes": 30,
            "quantity": "1 porción",
            "instructions": "Instrucciones específicas"
          }
        ],
        "llm_overall_reasoning": "Resumen de la estrategia de suplementación para este entrenamiento."
      }

      RECUERDA: Cada producto debe tener un consumption_timing DIFERENTE.
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
                max_tokens: 800, // Ajusta según la longitud esperada de la respuesta y los productos
            });
            llmResponseContent = completion.choices[0].message.content;
        } 
        else if (LLM_PROVIDER === 'gemini' && geminiModel) {
            console.log('Making Gemini API request...');
            // Construir el prompt para Gemini (combina system y user prompts)
            const geminiPrompt = `${systemPrompt}\n\n${userMessagePrompt}`;
            
            // Configurar el modelo de generación
            const genParams = {
                temperature: 0.3,
                maxOutputTokens: 800,
            };
            
            // Hacer la llamada a la API de Gemini
            const result = await geminiModel.generateContent(geminiPrompt, genParams);
            const response = await result.response;
            llmResponseContent = response.text();
            
            // Limpiar la respuesta si está envuelta en un bloque de código markdown
            if (llmResponseContent.includes('```json')) {
                console.log('Respuesta de Gemini incluye formato markdown, limpiando...');
                llmResponseContent = llmResponseContent
                    .replace(/```json\n/g, '') // Eliminar ```json inicial
                    .replace(/```(\s*)$/g, ''); // Eliminar ``` final
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
            // Validar que los product_id sean números
            parsedResponse.recommendations.forEach(rec => {
                if (typeof rec.product_id !== 'number') {
                    console.warn(`LLM returned a non-numeric product_id: ${rec.product_id}. Attempting to parse.`);
                    const parsedId = parseInt(rec.product_id, 10);
                    if (isNaN(parsedId)) {
                        throw new Error(`LLM returned an invalid non-numeric product_id that could not be parsed: ${rec.product_id}`);
                    }
                    rec.product_id = parsedId;
                }
            });
            return {
                recommendations: parsedResponse.recommendations,
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
function getFallbackRecommendations(userProfile, candidateProducts, numRecommendations = 3) {
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
                if (product.category.toLowerCase().includes('proteina')) score += 10;
            }
            else if (goal.includes('rendimiento') || goal.includes('resistencia')) {
                // Priorizar productos con más carbohidratos para energía
                score += (product.carbs_g || 0) * 1.5;
                if (product.category.toLowerCase().includes('energia')) score += 10;
            }
            else if (goal.includes('perder') || goal.includes('peso')) {
                // Priorizar productos con menos calorías
                score += 500 - (product.energy_kcal || 0);
            }
        }
        
        // Verificar restricciones dietéticas
        if (userProfile.dietary_restrictions) {
            const restrictions = userProfile.dietary_restrictions.toLowerCase();
            const attributes = product.attributes.map(a => a.toLowerCase());
            
            if (restrictions.includes('vegano') && !attributes.includes('vegano')) {
                score -= 1000; // Penalizar fuertemente si no cumple la restricción
            }
            else if (restrictions.includes('vegetariano') && 
                    !attributes.includes('vegetariano') && 
                    !attributes.includes('vegano')) {
                score -= 1000;
            }
        }
        
        // Verificar tolerancia a cafeína
        if (userProfile.caffeine_tolerance && product.caffeine_mg) {
            const tolerance = userProfile.caffeine_tolerance.toLowerCase();
            
            if (tolerance === 'no' && product.caffeine_mg > 0) {
                score -= 1000; // Eliminar productos con cafeína
            }
            else if (tolerance === 'bajo' && product.caffeine_mg > 50) {
                score -= 500; // Penalizar productos con mucha cafeína
            }
        }
        
        return { ...product, score };
    });
    
    // Ordenar por puntaje
    scoredProducts.sort((a, b) => b.score - a.score);
    
    // Distribuir productos por timing (antes, durante, después)
    const recommendations = [];
    const timingNeeded = ['antes', 'durante', 'despues'];
    const usedTimings = new Set();
    
    // Función helper para determinar el timing natural del producto
    const getNaturalTiming = (product) => {
        const productName = product.name.toLowerCase();
        
        if (productName.includes('rego') || productName.includes('recovery') || productName.includes('protein')) {
            return 'despues';
        } else if (productName.includes('gel') || productName.includes('hydro') || productName.includes('electrolyte')) {
            return 'durante';
        } else if (productName.includes('energy') || productName.includes('beta fuel')) {
            return 'antes';
        } else if (productName.includes('vitamin') || productName.includes('bcaa') || productName.includes('immune')) {
            return 'diario';
        }
        return 'durante'; // Default
    };
    
    // Intentar asignar un producto a cada timing
    for (const timing of timingNeeded) {
        const suitableProduct = scoredProducts.find(p => {
            const naturalTiming = getNaturalTiming(p);
            return (naturalTiming === timing || naturalTiming === 'diario') && !usedTimings.has(p.product_id);
        });
        
        if (suitableProduct) {
            usedTimings.add(suitableProduct.product_id);
            recommendations.push(suitableProduct);
        }
    }
    
    // Si no conseguimos 3, agregar los mejores que falten
    if (recommendations.length < 3) {
        const remaining = scoredProducts.filter(p => !usedTimings.has(p.product_id));
        recommendations.push(...remaining.slice(0, 3 - recommendations.length));
    }
    
    // Generar detalles de cada recomendación con timing de consumo distribuido
    const finalRecommendations = recommendations.map((product, index) => {
        let reasoning = `Este producto es adecuado para tu perfil`;
        
        if (userProfile.primary_goal) {
            reasoning += ` y tu objetivo de ${userProfile.primary_goal}`;
        }
        
        if (product.protein_g && product.protein_g > 15) {
            reasoning += `. Alto contenido de proteínas (${product.protein_g}g).`;
        } else if (product.carbs_g && product.carbs_g > 20) {
            reasoning += `. Buena fuente de carbohidratos (${product.carbs_g}g).`;
        }
        
        // Determinar timing de consumo basado en el timing asignado
        const naturalTiming = getNaturalTiming(product);
        let consumption_timing = naturalTiming;
        let timing_minutes = null;
        let quantity = '1 porción';
        let instructions = 'Seguir indicaciones del empaque';
        
        const productName = product.name.toLowerCase();
        
        // Configurar detalles según el timing
        if (consumption_timing === 'antes') {
            timing_minutes = 30;
            if (productName.includes('energy') || productName.includes('bar')) {
                quantity = '1 barra o porción';
                instructions = 'Consumir 30 minutos antes para energía sostenida';
                reasoning += ' Ideal para preparar tu cuerpo antes del esfuerzo.';
            }
        } else if (consumption_timing === 'durante') {
            if (productName.includes('gel')) {
                quantity = '1 gel cada 30-45 minutos';
                instructions = 'Consumir con pequeños sorbos de agua si es necesario';
                reasoning += ' Proporciona energía rápida durante el ejercicio.';
            } else if (productName.includes('hydro') || productName.includes('electrolyte')) {
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
        }
        
        return {
            product_id: product.product_id,
            reasoning: reasoning,
            consumption_timing: consumption_timing,
            timing_minutes: timing_minutes,
            quantity: quantity,
            instructions: instructions
        };
    });
    
    console.log(`✅ Fallback: Generadas ${finalRecommendations.length} recomendaciones distribuidas por timing`);
    finalRecommendations.forEach(r => {
        console.log(`   - ${r.consumption_timing.toUpperCase()}: Producto ${r.product_id}`);
    });
    
    return {
        recommendations: finalRecommendations,
        llmReasoning: "Recomendaciones distribuidas en antes, durante y después del entrenamiento.",
        promptUsed: "Sistema de respaldo (sin LLM)"
    };
}