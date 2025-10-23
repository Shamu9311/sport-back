// services/retrievalService.js
import { createConnection } from '../config/db.js';

const db = createConnection();
const MAX_CANDIDATE_PRODUCTS = 20; // Número máximo de productos a recuperar

export const getCandidateProducts = async (userProfile) => {
    if (!userProfile) {
        throw new Error("User profile is required for product retrieval.");
    }

    let query = `
        SELECT
            p.product_id,
            p.name AS product_name,
            p.description AS product_description,
            p.usage_recommendation,
            pt.name AS type_name,
            pc.name AS category_name,
            pc.usage_context,
            GROUP_CONCAT(DISTINCT pa.name) AS attributes,
            GROUP_CONCAT(DISTINCT f.name) AS flavors,
            MAX(pn.serving_size) AS serving_size,
            MAX(pn.energy_kcal) AS energy_kcal,
            MAX(pn.protein_g) AS protein_g,
            MAX(pn.carbs_g) AS carbs_g,
            MAX(pn.sugars_g) AS sugars_g,
            MAX(pn.sodium_mg) AS sodium_mg,
            MAX(pn.caffeine_mg) AS caffeine_mg
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.type_id
        LEFT JOIN product_categories pc ON pt.category_id = pc.category_id
        LEFT JOIN product_attributes_mapping pam ON p.product_id = pam.product_id
        LEFT JOIN product_attributes pa ON pam.attribute_id = pa.attribute_id
        LEFT JOIN product_flavors pf ON p.product_id = pf.product_id
        LEFT JOIN flavors f ON pf.flavor_id = f.flavor_id
        LEFT JOIN product_nutrition pn ON p.product_id = pn.product_id
        WHERE p.is_active = 1
    `;

    const queryParams = [];
    const whereClauses = [];

    // Filtrar por restricciones dietéticas
    // Esto es simplificado. Si tienes una tabla de unión para user_profile_dietary_restrictions, la query sería más compleja.
    // Por ahora, asumimos que userProfile.dietary_restrictions es un string que coincide con un product_attributes.name
    // Ejemplo: 'vegano', 'libre de gluten'. Si son múltiples, necesitarás parsear el string o mejorar la BD.
    if (userProfile.dietary_restrictions && userProfile.dietary_restrictions.toLowerCase() !== 'no') {
        // Suponemos que dietary_restrictions es una sola palabra como 'vegetariano', 'vegano', etc.
        // Esta parte necesitará ser más robusta si el usuario puede tener múltiples restricciones.
        // Por ahora, vamos a asumir que es UNA de las opciones de product_attributes.name
        // Podrías necesitar una subconsulta o JOINs más complejos si el usuario tiene 'vegetariano, libre de gluten'
        const restrictions = userProfile.dietary_restrictions.split(',').map(r => r.trim().toLowerCase());
        
        // Ejemplo MUY simplificado, puede no cubrir todos los casos de product_attributes bien
        // Necesitarías un mapeo o lógica más compleja para restricciones múltiples o compuestas
        restrictions.forEach(restriction => {
            // Esta condición es general y puede no ser 100% precisa para todos los mapeos posibles
            // ej. un producto 'vegano' también es 'vegetariano'.
            // Necesitas tener los product_attributes BIEN definidos para esto.
             if (restriction === 'vegetariano') {
                whereClauses.push(`(pa.name = 'vegetariano' OR pa.name = 'vegano')`); // Vegano implica vegetariano
            } else if (restriction === 'vegano') {
                 whereClauses.push(`pa.name = 'vegano'`);
            } else if (restriction === 'libre de gluten') {
                 whereClauses.push(`pa.name = 'libre de gluten'`);
            } // ... y así sucesivamente para otras restricciones mapeadas a tus 'product_attributes.name'
            // Este es un punto crítico a refinar basado en cómo modeles las restricciones y los atributos
        });
    }

    // Filtrar/priorizar por tolerancia a la cafeína
    if (userProfile.caffeine_tolerance) {
        switch (userProfile.caffeine_tolerance.toLowerCase()) {
            case 'no':
                whereClauses.push(`(pn.caffeine_mg IS NULL OR pn.caffeine_mg = 0)`);
                break;
            case 'bajo': // Permitir bajo o nulo
                whereClauses.push(`(pn.caffeine_mg IS NULL OR pn.caffeine_mg <= 50)`); // 50mg como ejemplo de bajo
                break;
            // Para 'medio' o 'alto', podríamos no filtrar o incluso priorizar los que SÍ tienen cafeína,
            // pero eso se vuelve más una priorización que un filtro duro.
            // Para la recuperación inicial, los filtros duros son más fáciles.
        }
    }

    if (whereClauses.length > 0) {
        query += ` AND (${whereClauses.join(' AND ')})`; // O 'OR' dependiendo de la lógica exacta deseada
    }

    query += `
        GROUP BY p.product_id, pt.name, pc.name, pc.usage_context, p.name, p.description, p.usage_recommendation
        ORDER BY 
    `;

    // Lógica de Priorización (ORDER BY) - Esto es CLAVE
    const orderByClauses = [];
    if (userProfile.primary_goal) {
        switch (userProfile.primary_goal.toLowerCase()) {
            case 'ganar musculo':
            case 'recuperacion':
                orderByClauses.push(`(CASE WHEN pc.name = 'recuperacion' THEN 0 ELSE 1 END)`);
                // Usamos MAX() para pa.name en el ORDER BY para cumplir con ONLY_FULL_GROUP_BY
                orderByClauses.push(`MAX(CASE WHEN pa.name = 'alto en proteina' THEN 0 ELSE 1 END)`);
                orderByClauses.push(`MAX(pn.protein_g) DESC`);
                break;
            case 'mejor rendimiento':
            case 'resistencia':
                orderByClauses.push(`(CASE WHEN pc.name = 'energia' THEN 0 ELSE 1 END)`);
                // Usamos MAX() para pa.name en el ORDER BY para cumplir con ONLY_FULL_GROUP_BY
                orderByClauses.push(`MAX(CASE WHEN pa.name = 'alto en carbohidrato' THEN 0 ELSE 1 END)`);
                orderByClauses.push(`MAX(pn.carbs_g) DESC`);
                break;
            case 'perder peso':
                orderByClauses.push(`MAX(pn.energy_kcal) ASC`); // Menos calorías primero
                orderByClauses.push(`MAX(pn.sugars_g) ASC`); // Menos azúcar primero
                break;
            // case 'por salud':
            //     // Podría priorizar vitaminas, productos con menos azúcar, etc.
            //     orderByClauses.push(`(CASE WHEN pc.name = 'vitaminas' THEN 0 ELSE 1 END)`);
            //     break;
        }
    }

    // Priorizar por nivel de actividad podría influir en el tipo de producto
    // Ejemplo: muy activo -> más necesidad de energía y recuperación
    if (userProfile.activity_level && (userProfile.activity_level.toLowerCase() === 'activo' || userProfile.activity_level.toLowerCase() === 'muy activo')) {
        orderByClauses.push(`(CASE WHEN pc.name IN ('energia', 'recuperacion') THEN 0 ELSE 1 END)`);
    }


    if (orderByClauses.length > 0) {
        query += orderByClauses.join(', ');
    } else {
        // Un ordenamiento por defecto si no hay criterios específicos
        query += `p.product_id`;
    }

    query += ` LIMIT ?`;
    queryParams.push(MAX_CANDIDATE_PRODUCTS);

    // console.log("Constructed Query:", query); // Para debugging
    // console.log("Query Params:", queryParams); // Para debugging

    try {
        const [rows] = await db.query(query, queryParams);
        if (rows.length === 0) {
            console.warn("No candidate products found with current filters/profile. Consider broadening criteria or fetching defaults.");
            // Podrías tener una lógica de fallback aquí para devolver algunos productos por defecto si no se encuentra nada.
        }
        return rows.map(row => ({ // Mapear a un formato un poco más limpio para el LLM
            product_id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            usage_recommendation: row.usage_recommendation,
            type: row.type_name,
            category: row.category_name,
            usage_context: row.usage_context,
            attributes: row.attributes ? row.attributes.split(',') : [],
            // flavors: row.flavors ? row.flavors.split(',') : [], // Sabores puede ser mucho ruido para el LLM inicial
            serving_size: row.serving_size,
            energy_kcal: row.energy_kcal,
            protein_g: row.protein_g,
            carbs_g: row.carbs_g,
            sugars_g: row.sugars_g,
            sodium_mg: row.sodium_mg,
            caffeine_mg: row.caffeine_mg,
        }));
    } catch (error) {
        console.error("Error retrieving candidate products:", error);
        throw new Error("Failed to retrieve candidate products from database.");
    }
}