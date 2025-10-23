-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 02-05-2025 a las 15:47:44
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `sport`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `flavors`
--

CREATE TABLE `flavors` (
  `flavor_id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `flavors`
--

INSERT INTO `flavors` (`flavor_id`, `name`) VALUES
(1, 'Orange'),
(2, 'Lemon & Lime'),
(3, 'Tropical'),
(4, 'Blackcurrant'),
(5, 'Apple'),
(6, 'Cherry'),
(7, 'Fruit Salad'),
(8, 'Pineapple'),
(9, 'Pink Grapefruit'),
(10, 'Berry'),
(11, 'Cola'),
(12, 'Double Espresso'),
(13, 'Raspberry'),
(14, 'Lemon & Mint'),
(15, 'Salted Caramel'),
(16, 'Strawberry & Lime'),
(17, 'Chocolate'),
(18, 'Vanilla'),
(19, 'Tiramisu'),
(20, 'Blueberry'),
(21, 'Banana'),
(22, 'Strawberry'),
(23, 'Raspberry'),
(24, 'Lemon'),
(25, 'White chocolate fudge'),
(26, 'Cookies and Cream');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `products`
--

CREATE TABLE `products` (
  `product_id` int(11) NOT NULL,
  `type_id` int(11) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `usage_recommendation` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `products`
--

INSERT INTO `products` (`product_id`, `type_id`, `name`, `description`, `image_url`, `usage_recommendation`, `is_active`) VALUES
(1, 1, 'GO Energy Isotonic Gel', 'Diseñado para entregar un suministro rápido y conveniente de carbohidratos de fácil digestión sin necesidad de agua. Primer gel isotónico del mundo.', '1.png', 'Consumir antes o durante ejercicio prolongado. No requiere agua.', 1),
(2, 2, 'GO Energy + Caffeine Gel', 'Proporciona carbohidratos de rápida absorción junto con cafeína para enfoque físico y mental.', '2.png', 'Ideal para competencias de alta intensidad cuando se necesita un impulso extra.', 1),
(3, 3, 'GO Energy + Electrolyte Gel', 'Proporciona 22g de carbohidratos más electrolitos (118mg sodio, 8.5mg potasio, 1.5mg magnesio) por gel.', '3.png', 'Ideal durante ejercicio cuando la pérdida de sodio es alta.', 1),
(4, 4, 'BETA Fuel Dual Source Energy Gel', 'Contiene 40g de carbohidratos en ratio 1:0.8 maltodextrina:fructosa para máximo rendimiento.', '4.png', 'Para eventos de más de 2 horas. Consumir 1-2 geles por hora.', 1),
(5, 5, 'BETA Fuel + Nootropics Gel', 'Combina 40g de carbohidratos con Cognizin® Citicoline para mejorar rendimiento físico y mental.', '5.png', 'Para situaciones que requieren enfoque mental y resistencia física.', 1),
(6, 6, 'GO Energy Bakes', 'Barra horneada con 30g de carbohidratos (10g fructosa) y centro de fruta.', '6.png', 'Consumir durante ejercicios de larga duración (60-90g carbohidratos/hora).', 1),
(7, 7, 'GO Energy Bars', 'Barra nutritiva hecha de frutas y dátiles con 25g de carbohidratos por barra.', '7.png', 'Para días de entrenamiento duro o día previo a competencia.', 1),
(8, 8, 'GO Electrolyte Powder', 'Mezcla de carbohidratos (36g) y electrolitos (sodio) para hidratación óptima.', '8.png', 'Mezclar con 500ml agua. Usar antes o durante ejercicio.', 1),
(9, 9, 'HYDRO Tablet', 'Tableta efervescente alta en sodio para hidratación sin calorías.', '9.png', 'Disolver en 500ml agua. Usar cuando se necesita hidratación sin calorías.', 1),
(10, 10, 'HYDRO + Caffeine Tablet', 'Tableta efervescente con 75mg cafeína para hidratación con impulso energético.', '10.png', 'Para hidratación con beneficio de cafeína.', 1),
(11, 11, 'REGO Rapid Recovery', 'Polvo con 20g proteína de suero y 22g carbohidratos para recuperación post-ejercicio.', '11.png', 'Consumir inmediatamente después del ejercicio.', 1),
(12, 12, 'REGO Rapid Recovery+', 'Versión avanzada con 24g proteína, 38g carbohidratos, BCAAs y L-Glutamina.', '12.png', 'Para sesiones intensas o prolongadas.', 1),
(13, 13, 'SiS Protein Bars', 'Barra de proteína (20g por paquete) cubierta de chocolate.', '13.png', 'Para crecimiento y recuperación muscular.', 1),
(14, 14, 'BCAA Tablets', '4g de aminoácidos ramificados en ratio 2:1:1 (Leucina, Isoleucina, Valina).', '14.png', 'Tomar antes, durante o después del entrenamiento.', 1),
(15, 15, 'Daily Multivitamins', 'Contiene 7 vitaminas esenciales (A, D, E, C, Tiamina, Riboflavina, Niacina).', '15.png', 'Una tableta diaria para apoyo nutricional.', 1),
(16, 16, 'IMMUNE Tablet', 'Tableta efervescente con 200mg Vitamina C y 2.5mg Hierro para apoyo inmunológico.', '16.png', 'Disolver en agua. Usar antes/durante/después del ejercicio.', 1),
(17, 4, 'BETA FUEL 80 Dual Source Energy Drink', 'Polvo energético con 80g de carbohidratos en ratio 1:0.8 maltodextrina:fructosa. Favorecido por atletas de élite para eventos de más de 2 horas.', '17.png', 'Mezclar con agua. Consumir 80-120g de carbohidratos por hora durante eventos de resistencia.', 1),
(18, 4, 'BETA FUEL ENERGY CHEWS', 'Gomitas energéticas con 48g de carbohidratos por paquete (7g por gomita). Formato fácil de consumir durante ejercicio.', '18.png', 'Consumir 1-3 gomitas cada hora durante ejercicio para alcanzar 80-120g de carbohidratos por hora.', 1);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_attributes`
--

CREATE TABLE `product_attributes` (
  `attribute_id` int(11) NOT NULL,
  `name` enum('vegetariano','vegano','libre de gluten','libre de lactosa','libre de trigo','libre de frutos secos','libre de soya','con cafeina','isotonico','alto en carbohidrato','alto en proteina') DEFAULT NULL,
  `description` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_attributes`
--

INSERT INTO `product_attributes` (`attribute_id`, `name`, `description`) VALUES
(1, 'vegetariano', NULL),
(2, 'vegano', NULL),
(3, 'libre de gluten', NULL),
(4, 'libre de lactosa', NULL),
(5, 'libre de trigo', NULL),
(6, 'libre de frutos secos', NULL),
(7, 'libre de soya', NULL),
(8, 'con cafeina', NULL),
(9, 'isotonico', NULL),
(10, 'alto en carbohidrato', NULL),
(11, 'alto en proteina', NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_attributes_mapping`
--

CREATE TABLE `product_attributes_mapping` (
  `product_id` int(11) NOT NULL,
  `attribute_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_attributes_mapping`
--

INSERT INTO `product_attributes_mapping` (`product_id`, `attribute_id`) VALUES
(1, 1),
(1, 3),
(1, 4),
(1, 9),
(2, 1),
(2, 3),
(2, 4),
(2, 8),
(2, 9),
(3, 1),
(3, 3),
(3, 4),
(3, 9),
(4, 1),
(4, 3),
(4, 4),
(4, 10),
(5, 1),
(5, 3),
(5, 4),
(5, 8),
(5, 10),
(6, 1),
(6, 3),
(7, 1),
(7, 2),
(7, 3),
(7, 4),
(8, 1),
(8, 3),
(8, 4),
(9, 1),
(9, 2),
(9, 3),
(9, 4),
(9, 5),
(9, 6),
(10, 1),
(10, 2),
(10, 3),
(10, 4),
(10, 5),
(10, 6),
(10, 8),
(11, 1),
(11, 3),
(11, 11),
(12, 1),
(12, 3),
(12, 11),
(13, 1),
(13, 11),
(14, 1),
(14, 2),
(14, 3),
(14, 4),
(14, 7),
(15, 1),
(15, 2),
(15, 3),
(15, 4),
(16, 1),
(16, 2),
(16, 3),
(16, 4),
(16, 5),
(16, 6),
(16, 7),
(17, 1),
(17, 3),
(17, 4),
(17, 10),
(18, 1),
(18, 3),
(18, 4),
(18, 10);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_categories`
--

CREATE TABLE `product_categories` (
  `category_id` int(11) NOT NULL,
  `name` enum('energia','hidratacion','recuperacion','vitaminas') DEFAULT NULL,
  `description` text DEFAULT NULL,
  `usage_context` enum('pre entrenamiento','durante entrenamiento','post entrenamiento','diario') DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_categories`
--

INSERT INTO `product_categories` (`category_id`, `name`, `description`, `usage_context`) VALUES
(1, 'energia', 'Productos diseñados para proporcionar energía antes o durante el ejercicio', 'pre entrenamiento'),
(2, 'hidratacion', 'Productos para mantener una hidratación óptima durante el ejercicio', 'durante entrenamiento'),
(3, 'recuperacion', 'Productos para ayudar en la recuperación muscular después del ejercicio', 'post entrenamiento'),
(4, 'vitaminas', 'Suplementos vitamínicos para apoyo nutricional', 'diario');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_flavors`
--

CREATE TABLE `product_flavors` (
  `product_id` int(11) NOT NULL,
  `flavor_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_flavors`
--

INSERT INTO `product_flavors` (`product_id`, `flavor_id`) VALUES
(1, 1),
(1, 2),
(1, 3),
(1, 4),
(1, 5),
(1, 6),
(1, 7),
(1, 8),
(1, 9),
(2, 10),
(2, 11),
(2, 12),
(3, 13),
(3, 14),
(3, 15),
(4, 1),
(4, 16),
(5, 2),
(5, 5),
(6, 2),
(6, 17),
(6, 19),
(7, 5),
(7, 18),
(7, 20),
(7, 21),
(7, 22),
(8, 1),
(8, 2),
(8, 3),
(8, 4),
(9, 2),
(9, 8),
(9, 9),
(9, 10),
(9, 16),
(10, 11),
(11, 17),
(11, 18),
(11, 23),
(12, 13),
(12, 18),
(13, 24),
(13, 25),
(13, 26),
(16, 1),
(17, 1),
(17, 16),
(17, 22),
(18, 1),
(18, 2);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_nutrition`
--

CREATE TABLE `product_nutrition` (
  `nutrition_id` int(11) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `serving_size` varchar(50) DEFAULT NULL,
  `energy_kcal` decimal(10,2) DEFAULT NULL,
  `protein_g` decimal(10,2) DEFAULT NULL,
  `carbs_g` decimal(10,2) DEFAULT NULL,
  `sugars_g` decimal(10,2) DEFAULT NULL,
  `sodium_mg` decimal(10,2) DEFAULT NULL,
  `potassium_mg` decimal(10,2) NOT NULL,
  `magnesium_mg` decimal(10,2) NOT NULL,
  `caffeine_mg` decimal(10,2) DEFAULT NULL,
  `other_components` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_nutrition`
--

INSERT INTO `product_nutrition` (`nutrition_id`, `product_id`, `serving_size`, `energy_kcal`, `protein_g`, `carbs_g`, `sugars_g`, `sodium_mg`, `potassium_mg`, `magnesium_mg`, `caffeine_mg`, `other_components`) VALUES
(1, 1, '60ml', 81.00, 0.10, 22.00, 0.60, 118.00, 0.00, 0.00, 0.00, 'None'),
(2, 2, '60ml', 89.00, 0.10, 22.00, 0.80, 60.00, 0.00, 0.00, 75.00, 'None'),
(3, 3, '60ml', 81.00, 0.10, 22.00, 0.60, 118.00, 8.50, 1.50, 0.00, 'None'),
(4, 4, '60ml', 158.00, 0.00, 40.00, 19.00, 30.00, 0.00, 0.00, 0.00, 'None'),
(5, 5, '60ml', 112.00, 0.00, 40.00, 0.60, 200.00, 0.00, 0.00, 200.00, 'L-Taurine 1g, Cognizin® 250mg, L-Theanine 200mg'),
(6, 6, '1 bake (60g)', 250.00, 3.00, 30.00, 10.00, 0.25, 0.00, 0.00, 0.00, 'None'),
(7, 7, '1 bar (45g)', 215.00, 1.50, 25.00, 1.90, 0.10, 0.00, 0.00, 0.00, 'None'),
(8, 8, '50g en 500ml', 144.00, 0.00, 36.00, 1.00, 500.00, 0.00, 0.00, 0.00, 'None'),
(9, 9, '1 tableta', 0.00, 0.00, 0.30, 0.00, 210.00, 80.00, 0.50, 0.00, 'None'),
(10, 10, '1 tableta', 3.00, 0.00, 0.50, 0.00, 120.00, 0.00, 0.00, 75.00, 'None'),
(11, 11, '70g', 270.00, 20.00, 22.00, 1.00, 1.00, 0.00, 0.00, 0.00, 'None'),
(12, 12, '70g', 320.00, 24.00, 38.00, 2.50, 0.20, 0.00, 0.00, 0.00, 'BCAAs 4g (incl. 4g Leucine), L-Glutamine 5g'),
(13, 13, '2 barras (64g)', 256.00, 20.00, 11.00, 1.80, 0.10, 0.00, 0.00, 0.00, 'None'),
(14, 14, '2 tabletas', 0.00, 4.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 'Leucina 2g, Isoleucina 1g, Valina 1g'),
(15, 15, '1 tableta', 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 'Vitamina A 800μg, Vitamina D 10μg, Vitamina E 12mg, Vitamina C 80mg, Tiamina 1.1mg, Riboflavina 1.4mg, Niacina 16mg'),
(16, 16, '1 tableta', 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 'Vitamina C 200mg, Hierro 2.5mg, Sodio 0.9g'),
(17, 17, '100g', 378.00, 0.00, 80.00, 5.40, 0.80, 0.00, 0.00, NULL, 'None'),
(18, 18, '100g', 338.00, 2.40, 74.00, 6.70, 0.10, 0.00, 0.00, NULL, 'None'),
(19, 18, 'Por chew (7g)', 24.00, 0.20, 5.20, 0.50, 0.01, 0.00, 0.00, NULL, 'None');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `product_types`
--

CREATE TABLE `product_types` (
  `type_id` int(11) NOT NULL,
  `category_id` int(11) DEFAULT NULL,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `product_types`
--

INSERT INTO `product_types` (`type_id`, `category_id`, `name`, `description`) VALUES
(1, 1, 'GO Energy Isotonic Gels', 'Gel isotónico del mundo y ganador del Premio Queen’s Award for Enterprise. Ofrece una fuente rápida y conveniente de carbohidratos sabrosos y fáciles de digerir, sin necesidad de agua, siendo ideal para atletas de élite. Proporciona energía instantánea gracias a sus carbohidratos fáciles de asimilar, sin el exceso de líquido que puede causar hinchazón o pesadez. Viene en un empaque práctico y ligero, fácil de llevar en lugar de botellas deportivas voluminosas, y es una opción clave dentro de cualquier estrategia de hidratación y energía.'),
(2, 1, 'GO Energy + Caffeine Gels', 'Gel energético diseñado para competiciones de alta intensidad, que combina carbohidratos de rápida absorción y fácil digestión con cafeína. Esta combinación aporta un impulso físico y mental cuando más lo necesitas. Ideal para eventos de resistencia largos y exigentes, ayuda a combatir la fatiga causada por el agotamiento de carbohidratos. Los geles son limpios en boca, fáciles de digerir y transportar, proporcionando un plus de energía mental y física antes o durante el ejercicio.'),
(3, 1, 'GO Energy + Electrolyte Gels', 'Gel que se basa en la ciencia comprobada del GO Isotonic Energy Gel, el primer y único gel energético verdaderamente isotónico del mundo. Ofrece un suministro rápido de carbohidratos fáciles de digerir (22 g) para energía, además de proporcionar electrolitos esenciales: 118 mg de sodio, 9.5 mg de potasio y 1.5 mg de magnesio por gel. Es ideal para consumir durante el ejercicio cuando la pérdida de sodio es alta.'),
(4, 1, 'BETA Fuel Gels', 'Gel optimizado con una nueva proporción de 1:0.8, aporta 40 g de carbohidratos para mejorar tu potencia, aumentar la eficiencia en el uso de carbohidratos por parte de tu cuerpo y reducir el malestar gastrointestinal, ofreciendo un combustible científicamente superior.  Como atleta de resistencia (tus eventos suelen durar más de dos horas), necesitas consumir entre 80-120 g de carbohidratos por hora. Este gel proporciona 40 g de carbohidratos en una solución práctica y segura, con mínimo riesgo de molestias estomacales, permitiéndote mantener un rendimiento óptimo.'),
(5, 1, 'BETA Fuel + Nootropics', 'Fuente de energía líder a nivel mundial, que combina un nuevo ratio de carbohidratos con Cognizin® Citicoline para mejorar tanto el rendimiento físico como mental. Este gel contiene 40 gramos de carbohidratos, 1 gramo del aminoácido L-taurina, 250 miligramos de Cognizin® para potenciar el procesamiento de información y 200 miligramos de cafeína combinados con 200 miligramos de L-teanina. La L-teanina aumenta la sensación subjetiva de alerta mientras reduce los \"nervios\" o temblores asociados con la cafeína pura, ofreciendo un impulso equilibrado para el cuerpo y la mente.'),
(6, 1, 'GO Energy Bakes', 'Ofrece 30 gramos de carbohidratos en una suave barra horneada con relleno de fruta, que aporta 10 gramos de fructosa. Para apoyar el rendimiento y satisfacer las demandas del ejercicio, se recomienda consumir entre 60-90 gramos de carbohidratos por hora durante eventos de larga resistencia. La GO Energy Bake de Science in Sport ayuda a cumplir con estos requerimientos y puede combinarse con otros productos de la gama GO. Su textura única, suave y horneada, es fácil de consumir y proporciona todos los beneficios del aporte de carbohidratos para optimizar el rendimiento.'),
(7, 1, 'GO Energy Bars', 'Opción nutritiva, fácil de digerir y rica en carbohidratos, elaborada a base de frutas e ingredientes saludables. Representan una solución práctica y nutritiva para proporcionar carbohidratos adicionales entre comidas durante días de entrenamiento intensos y el día previo a una competición.'),
(8, 2, 'GO Electrolyte Powder', 'Contiene una mezcla de carbohidratos de rápida absorción y fácil digestión, junto con electrolitos (como el sodio) que promueven una hidratación óptima. La combinación de fuentes de energía y electrolitos mejora la capacidad de tu cuerpo para absorber agua durante el ejercicio, mantener un rendimiento en resistencia y prevenir calambres. El producto está formulado con concentraciones equilibradas de carbohidratos (36 gramos como una solución al 6%), sodio (20 mmol/L) y líquido (porción de 500 ml), logrando los objetivos combinados de proporcionar energía e hidratación.'),
(9, 2, 'HYDRO Tablets', 'Tabletas efervescentes de hidratación diseñadas para garantizar que estés debidamente hidratado y así logres tu mejor rendimiento. En forma de tableta efervescente que se disuelve fácilmente en agua, ofrece una solución altamente práctica sin añadir calorías.'),
(10, 2, 'HYDRO + Caffeine Tablets', 'Tabletas con cafeína diseñadas para garantizar una hidratación efectiva que te permita rendir al máximo. En forma de tableta efervescente que se disuelve fácilmente en agua, ofrece una solución práctica sin calorías. Además, la incorporación de cafeína proporciona un impulso físico y mental, reduciendo la percepción de fatiga.'),
(11, 3, 'REGO Rapid Recovery', 'Suplemento alimenticio completo de recuperación que proporciona carbohidratos y proteínas de alta calidad, además de electrolitos, vitaminas y minerales, en una bebida práctica para consumir inmediatamente después del ejercicio. Ya sea que tu entrenamiento haya sido corto e intenso o largo y de resistencia, este producto reponer todo lo que has perdido durante el ejercicio y ayuda a tu cuerpo a recuperarse para que estés listo para rendir en la próxima sesión. Mezclado con agua, reabastece energía, hidrata tu cuerpo y repara y reconstruye tus músculos.'),
(12, 3, 'REGO Rapid Recovery+', 'Suplemento alimenticio completo que proporciona una mayor cantidad de carbohidratos y proteína de suero, además de BCAAs, L-Glutamina, vitaminas y minerales, en una bebida práctica para reponer mejor tus reservas de energía y promover la recuperación muscular después del ejercicio. Después de un entrenamiento prolongado o intenso, este producto contiene todo lo que necesitas en una sola bebida: reposición rápida de glucógeno y proteína de suero de alta calidad, ayudándote a sacar el máximo provecho de tu entrenamiento y prepararte para la siguiente sesión. Fácil de mezclar con agua, reabastece energía, hidrata tu cuerpo y repara y reconstruye tus músculos.'),
(13, 3, 'SiS Protein Bars', 'Barra proteica baja en azúcar y cubierta de chocolate. Convenientemente dividida en dos porciones de 32 g fáciles de consumir, es ideal para atletas que están siempre en movimiento. Cada paquete aporta 20 g de proteína para favorecer el crecimiento muscular.  Cada barra tiene un centro súper suave de proteínas, cuidadosamente mezclado para ofrecer un sabor insuperable, y está cubierta con caramelo pegajoso y crujientes proteicos, proporcionando una textura crujiente y placentera en cada bocado. Además, cada barra está generosamente recubierta con una capa de chocolate suave. Nunca una barra proteica había sabido tan bien.'),
(14, 4, 'BCAA Tablets', 'Los aminoácidos son bloques fundamentales para las proteínas en el cuerpo, esenciales para el rendimiento y la recuperación muscular. Tres de los nueve aminoácidos esenciales son los aminoácidos de cadena ramificada (BCAAs): Leucina, Isoleucina y Valina. Los BCAAs pueden promover la síntesis de proteínas musculares, el proceso mediante el cual se desarrolla el músculo, y también han demostrado reducir la degradación de proteínas. Las cápsulas de BCAA proporcionan 4 g de aminoácidos de cadena ramificada en una proporción 2:1:1 de Leucina, Isoleucina y Valina. En un práctico formato de cápsulas, pueden consumirse antes, durante o después del entrenamiento, o en cualquier momento del día.'),
(15, 4, 'Daily Multivitamins', 'Las vitaminas y minerales son esenciales para mantener la salud y el bienestar diarios, además de contribuir a muchas funciones corporales. A menudo es difícil obtener suficientes solo a través de la dieta, lo que puede llevar a un rendimiento subóptimo y mayor riesgo de enfermedades. El Daily Multivitamin está formulado para asegurar que recibas las cantidades adecuadas de las 7 vitaminas y minerales más importantes. Incluye vitaminas A, D, E, C, así como tiamina, riboflavina y niacina, combinadas en una sola tableta pequeña y fácil de consumir.'),
(16, 2, 'IMMUNE Tablets', 'Diseñado para apoyar y mantener la función inmunológica antes, durante y después del rendimiento. En forma de tableta efervescente que se disuelve fácilmente en agua, representa una solución práctica para fortalecer tu sistema inmunológico. El producto incluye 200 mg de Vitamina C y 2.5 mg de Hierro, nutrientes conocidos por contribuir al mantenimiento de la función normal del sistema inmune durante y después del ejercicio físico intenso, además de complementar tus necesidades diarias recomendadas (RDA).'),
(17, 1, 'ETA FUEL 80 Dual Source Energy Drink', 'Optimizada para atletas de élite, proporciona 80g de carbohidratos en una proporción 1:0.8, mejorando el rendimiento, la eficiencia energética y reduciendo molestias gastrointestinales. Ideal para deportes de resistencia, ofrece una solución isotónica conveniente que ayuda a mantener un alto nivel de desempeño durante actividades prolongadas.'),
(18, 1, 'BETA FUEL ENERGY CHEWS', 'Ofrece un combustible científico superior en forma de gomitas fáciles y satisfactorias de consumir. Con 46 gramos de carbohidratos rápidos, estas gomitas son parte de una gama líder de soluciones energéticas que incluye bebidas y geles. Son versátiles, ya que se pueden comer como una barra o separar en porciones individuales (cada una con aproximadamente 7g de carbohidratos). Para mantener un rendimiento óptimo, se recomienda consumir 1-3 barras de chews por hora, ajustándose a una ingesta objetivo de 80g-120g de carbohidratos durante el esfuerzo.');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `recommendations`
--

CREATE TABLE `recommendations` (
  `recommendation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `session_id` int(11) DEFAULT NULL,
  `product_id` int(11) NOT NULL,
  `recommended_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `feedback` enum('positivo','neutral','negativo') DEFAULT NULL,
  `feedback_notes` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `training_sessions`
--

CREATE TABLE `training_sessions` (
  `session_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `session_date` date NOT NULL,
  `duration_min` int(11) NOT NULL,
  `intensity` enum('bajo','medio','alto','muy alto') DEFAULT NULL,
  `type` enum('cardio','fuerza','hiit','resistencia','mixed','otro') DEFAULT NULL,
  `weather` enum('frio','fresco','moderado','calido','caliente','humedo') DEFAULT NULL,
  `notes` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `users`
--

INSERT INTO `users` (`user_id`, `username`, `email`, `password`, `created_at`) VALUES
(1, 'admin', 'admin@gmail.com', '$2b$10$UIj0IOiLDiLd9wO1lW3sWOBZEwbe/3VfEKkxxChjCjY931q/VF2f6', '2025-03-05 06:46:05'),
(2, 'andres', 'andres@outlook.com', '$2b$10$q/CgWN/bnUrgG3nNSPYmWO9ku5kbTQ465zBL4IwMiPWAe.fnUuqMe', '2025-03-05 07:21:49'),
(3, 'Nicole', 'nace@gmail.com', '$2b$10$cagPwWAVk4FQnjUTwCMNV.h57CaHF5k82iaJEY4d0ymz0X6DeB6ny', '2025-03-11 16:08:35'),
(4, 'xavier', 'xacq@msn.com', '$2b$10$d/ShEBW/FPf9/OT44PaUrOrj4kJPpRcXQ/4atis2NLuou1DVq1.ki', '2025-05-01 14:59:17'),
(5, 'juan', 'juan@gmail.com', '$2b$10$EQz6tKVZ8FOXhKDRZ4BgAuUsgOMUeixx8RXZXuRgjNzAKVLpHXLhK', '2025-05-01 15:36:17');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `user_profiles`
--

CREATE TABLE `user_profiles` (
  `profile_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `age` int(11) DEFAULT NULL,
  `weight` decimal(5,2) DEFAULT NULL,
  `height` decimal(5,2) DEFAULT NULL,
  `gender` enum('hombre','mujer','otro','prefiero no decir') DEFAULT NULL,
  `activity_level` enum('sedentario','','moderado','activo','muy activo') DEFAULT NULL,
  `training_frequency` enum('1-2','3-4','5+','ocacional') DEFAULT NULL,
  `primary_goal` enum('mejor rendimiento','perder peso','ganar musculo','resistencia','recuperacion','por salud') DEFAULT NULL,
  `sweat_level` enum('bajo','medio','alto') DEFAULT NULL,
  `caffeine_tolerance` enum('no','bajo','medio','alto') DEFAULT NULL,
  `dietary_restrictions` enum('vegetariano','vegano','libre de gluten','libre de lactosa','libre de frutos secos','no') DEFAULT 'no'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `user_profiles`
--

INSERT INTO `user_profiles` (`profile_id`, `user_id`, `age`, `weight`, `height`, `gender`, `activity_level`, `training_frequency`, `primary_goal`, `sweat_level`, `caffeine_tolerance`, `dietary_restrictions`) VALUES
(2, 5, 47, 100.00, 185.00, 'hombre', 'moderado', '3-4', 'mejor rendimiento', 'medio', 'medio', 'vegetariano');

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `flavors`
--
ALTER TABLE `flavors`
  ADD PRIMARY KEY (`flavor_id`);

--
-- Indices de la tabla `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`product_id`),
  ADD KEY `type_id` (`type_id`);

--
-- Indices de la tabla `product_attributes`
--
ALTER TABLE `product_attributes`
  ADD PRIMARY KEY (`attribute_id`);

--
-- Indices de la tabla `product_attributes_mapping`
--
ALTER TABLE `product_attributes_mapping`
  ADD PRIMARY KEY (`product_id`,`attribute_id`),
  ADD KEY `attribute_id` (`attribute_id`);

--
-- Indices de la tabla `product_categories`
--
ALTER TABLE `product_categories`
  ADD PRIMARY KEY (`category_id`);

--
-- Indices de la tabla `product_flavors`
--
ALTER TABLE `product_flavors`
  ADD PRIMARY KEY (`product_id`,`flavor_id`),
  ADD KEY `flavor_id` (`flavor_id`);

--
-- Indices de la tabla `product_nutrition`
--
ALTER TABLE `product_nutrition`
  ADD PRIMARY KEY (`nutrition_id`),
  ADD KEY `product_id` (`product_id`);

--
-- Indices de la tabla `product_types`
--
ALTER TABLE `product_types`
  ADD PRIMARY KEY (`type_id`),
  ADD KEY `category_id` (`category_id`);

--
-- Indices de la tabla `recommendations`
--
ALTER TABLE `recommendations`
  ADD PRIMARY KEY (`recommendation_id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `session_id` (`session_id`),
  ADD KEY `product_id` (`product_id`);

--
-- Indices de la tabla `training_sessions`
--
ALTER TABLE `training_sessions`
  ADD PRIMARY KEY (`session_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indices de la tabla `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indices de la tabla `user_profiles`
--
ALTER TABLE `user_profiles`
  ADD PRIMARY KEY (`profile_id`),
  ADD KEY `user_id` (`user_id`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `flavors`
--
ALTER TABLE `flavors`
  MODIFY `flavor_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=27;

--
-- AUTO_INCREMENT de la tabla `products`
--
ALTER TABLE `products`
  MODIFY `product_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT de la tabla `product_attributes`
--
ALTER TABLE `product_attributes`
  MODIFY `attribute_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT de la tabla `product_categories`
--
ALTER TABLE `product_categories`
  MODIFY `category_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT de la tabla `product_nutrition`
--
ALTER TABLE `product_nutrition`
  MODIFY `nutrition_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT de la tabla `product_types`
--
ALTER TABLE `product_types`
  MODIFY `type_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=35;

--
-- AUTO_INCREMENT de la tabla `recommendations`
--
ALTER TABLE `recommendations`
  MODIFY `recommendation_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `training_sessions`
--
ALTER TABLE `training_sessions`
  MODIFY `session_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT de la tabla `user_profiles`
--
ALTER TABLE `user_profiles`
  MODIFY `profile_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `products_ibfk_1` FOREIGN KEY (`type_id`) REFERENCES `product_types` (`type_id`);

--
-- Filtros para la tabla `product_attributes_mapping`
--
ALTER TABLE `product_attributes_mapping`
  ADD CONSTRAINT `product_attributes_mapping_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  ADD CONSTRAINT `product_attributes_mapping_ibfk_2` FOREIGN KEY (`attribute_id`) REFERENCES `product_attributes` (`attribute_id`);

--
-- Filtros para la tabla `product_flavors`
--
ALTER TABLE `product_flavors`
  ADD CONSTRAINT `product_flavors_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  ADD CONSTRAINT `product_flavors_ibfk_2` FOREIGN KEY (`flavor_id`) REFERENCES `flavors` (`flavor_id`);

--
-- Filtros para la tabla `product_nutrition`
--
ALTER TABLE `product_nutrition`
  ADD CONSTRAINT `product_nutrition_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`);

--
-- Filtros para la tabla `product_types`
--
ALTER TABLE `product_types`
  ADD CONSTRAINT `product_types_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `product_categories` (`category_id`);

--
-- Filtros para la tabla `recommendations`
--
ALTER TABLE `recommendations`
  ADD CONSTRAINT `recommendations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  ADD CONSTRAINT `recommendations_ibfk_2` FOREIGN KEY (`session_id`) REFERENCES `training_sessions` (`session_id`),
  ADD CONSTRAINT `recommendations_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`);

--
-- Filtros para la tabla `training_sessions`
--
ALTER TABLE `training_sessions`
  ADD CONSTRAINT `training_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

--
-- Filtros para la tabla `user_profiles`
--
ALTER TABLE `user_profiles`
  ADD CONSTRAINT `user_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
