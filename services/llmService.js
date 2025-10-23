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

      Por favor, recomienda hasta 3 productos de la lista proporcionada que sean más adecuados para este usuario.
      
      Para cada producto recomendado, proporciona su 'product_id' (tal como se dio en la entrada) y una 
      breve 'reasoning' (justificación) de por qué es adecuado para este usuario, basándote en su perfil 
      y los detalles del producto. Incluye información nutricional relevante en la justificación.

      Devuelve tu respuesta ÚNICAMENTE en formato JSON, de la siguiente manera:
      {
        "recommendations": [
          { 
            "product_id": <ID_PRODUCTO_1_ENTERO>, 
            "reasoning": "Justificación concisa para el producto 1...",
            "consumption_timing": "antes|durante|despues",
            "timing_minutes": 15,
            "quantity": "1 gel cada 30 minutos",
            "instructions": "No requiere agua"
          }
        ],
        "llm_overall_reasoning": "Un breve resumen general de tu proceso de pensamiento o por qué estos productos son buenos en conjunto, si aplica."
      }

      Si no hay productos perfectos, recomienda los que más se acerquen a las necesidades del usuario.
      Asegúrate de que el 'product_id' sea un NÚMERO ENTERO y que la justificación sea clara y relevante.
      No incluyas ningún texto introductorio o explicativo fuera del objeto JSON. Solo el JSON.
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
    
    // Ordenar por puntaje y tomar los mejores
    scoredProducts.sort((a, b) => b.score - a.score);
    const topProducts = scoredProducts.slice(0, numRecommendations);
    
    // Generar razones genéricas para cada recomendación con timing de consumo
    const recommendations = topProducts.map(product => {
        let reasoning = `Este producto es adecuado para tu perfil`;
        
        if (userProfile.primary_goal) {
            reasoning += ` y tu objetivo de ${userProfile.primary_goal}`;
        }
        
        if (product.protein_g && product.protein_g > 15) {
            reasoning += `. Alto contenido de proteínas (${product.protein_g}g).`;
        } else if (product.carbs_g && product.carbs_g > 20) {
            reasoning += `. Buena fuente de carbohidratos (${product.carbs_g}g).`;
        }
        
        // Determinar timing de consumo basado en el nombre/categoría del producto
        let consumption_timing = 'durante';
        let timing_minutes = null;
        let quantity = '1 porción';
        let instructions = 'Seguir indicaciones del empaque';
        
        const productName = product.name.toLowerCase();
        
        // Productos de energía (antes/durante)
        if (productName.includes('energy') || productName.includes('gel') || productName.includes('beta fuel')) {
            if (productName.includes('gel')) {
                consumption_timing = 'durante';
                quantity = '1 gel cada 30-45 minutos';
                instructions = 'Consumir con pequeños sorbos de agua si es necesario';
            } else {
                consumption_timing = 'antes';
                timing_minutes = 30;
                quantity = '1 porción';
            }
        }
        // Productos de hidratación (durante)
        else if (productName.includes('hydro') || productName.includes('electrolyte')) {
            consumption_timing = 'durante';
            quantity = '500ml durante el entrenamiento';
            instructions = 'Beber pequeños sorbos cada 15-20 minutos';
        }
        // Productos de recuperación (después)
        else if (productName.includes('rego') || productName.includes('recovery') || productName.includes('protein')) {
            consumption_timing = 'despues';
            timing_minutes = 30;
            quantity = '1 porción';
            instructions = 'Consumir dentro de los 30 minutos post-entrenamiento para mejor absorción';
        }
        // Vitaminas/BCAA (diario/flexible)
        else if (productName.includes('vitamin') || productName.includes('bcaa') || productName.includes('immune')) {
            consumption_timing = 'diario';
            quantity = '1 tableta al día';
            instructions = 'Preferiblemente con alimentos';
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
    
    return {
        recommendations,
        llmReasoning: "Recomendaciones basadas en tu perfil y preferencias.",
        promptUsed: "Sistema de respaldo (sin LLM)"
    };
}