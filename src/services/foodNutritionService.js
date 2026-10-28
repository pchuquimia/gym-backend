const cache = new Map();
const pending = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;
const error = (message, statusCode = 400, code = "INVALID_FOOD_QUERY") =>
  Object.assign(new Error(message), { statusCode, code });
const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const aliases = [
  ["pechuga de pollo", "chicken breast"],
  ["pechuga", "chicken breast"],
  ["arroz integral", "brown rice"],
  ["arroz blanco", "white rice"],
  ["clara de huevo", "egg white"],
  ["claras de huevo", "egg white"],
  ["carne de res", "beef"],
  ["carne molida", "ground beef"],
  ["yogur griego", "greek yogurt"],
  ["leche descremada", "skim milk"],
  ["pollo", "chicken"],
  ["arroz", "rice"],
  ["avena", "oats"],
  ["huevos", "egg"],
  ["huevo", "egg"],
  ["papa", "potato"],
  ["patata", "potato"],
  ["platano", "banana"],
  ["banana", "banana"],
  ["atun", "tuna"],
  ["salmon", "salmon"],
  ["brocoli", "broccoli"],
  ["lentejas", "lentils"],
  ["quinua", "quinoa"],
  ["quinoa", "quinoa"],
  ["pan integral", "whole wheat bread"],
  ["aceite de oliva", "olive oil"],
  ["aguacate", "avocado"],
  ["palta", "avocado"],
];
export const parseFoodQuantity = (input) => {
  if (typeof input !== "string" || input.length > 200)
    throw error("Escribe una cantidad en gramos y un alimento");
  const text = input.trim();
  const matches = [
    ...text.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(kilogramos?|kilos?|kg|gramos?|grs?|g)\b/gi,
    ),
  ];
  if (matches.length !== 1)
    throw error(
      "Indica una sola cantidad, por ejemplo: 200 g de pechuga de pollo",
    );
  const match = matches[0];
  if (match.index > 0 && /[-\d.,]/.test(text[match.index - 1]))
    throw error("Cantidad inválida");
  const grams =
    Number(match[1].replace(",", ".")) *
    (/^(kilo|kg)/i.test(match[2]) ? 1000 : 1);
  if (!Number.isFinite(grams) || grams < 0.1 || grams > 5000)
    throw error("Usa una cantidad entre 0,1 y 5000 g");
  const food = text
    .replace(match[0], "")
    .trim()
    .replace(/^de\s+/i, "")
    .replace(/\s+de$/i, "")
    .trim();
  if (food.length < 2 || !/[a-záéíóúñ]/i.test(food))
    throw error("Agrega el nombre del alimento después de la cantidad");
  return { grams: Math.round(grams * 1000) / 1000, food };
};
export const translateFoodQuery = (food) => {
  let query = normalize(food);
  for (const [spanish, english] of aliases) {
    const pattern = new RegExp(`\\b${spanish}\\b`, "g");
    if (pattern.test(query)) {
      query = query.replace(pattern, english);
      break;
    }
  }
  for (const [spanish, english] of [
    ["a la plancha", "grilled"],
    ["a la parrilla", "grilled"],
    ["al horno", "roasted"],
    ["sin piel", "skinless"],
    ["con piel", "with skin"],
    ["sin hueso", "boneless"],
    ["crudo", "raw"],
    ["cruda", "raw"],
    ["cocido", "cooked"],
    ["cocida", "cooked"],
    ["hervido", "boiled"],
    ["hervida", "boiled"],
    ["frito", "fried"],
    ["frita", "fried"],
  ])
    query = query.replace(new RegExp(`\\b${spanish}\\b`, "g"), english);
  return query.replace(/\s+/g, " ").trim();
};
export const scaleNutrients = (per100g, grams) =>
  Object.fromEntries(
    ["calories", "protein", "carbs", "fat"].map((key) => [
      key,
      Math.round(per100g[key] * grams) / 100,
    ]),
  );
const nutrient = (food, ids, unit) => {
  for (const id of ids) {
    const item = (food.foodNutrients || []).find(
      (value) =>
        value.nutrientId === id &&
        String(value.unitName).toUpperCase() === unit,
    );
    if (item && Number.isFinite(item.value) && item.value >= 0)
      return item.value;
  }
  return null;
};
export const normalizeUsdaFood = (food) => {
  const per100g = {
    calories: nutrient(food, [1008, 2048, 2047], "KCAL"),
    protein: nutrient(food, [1003], "G"),
    carbs: nutrient(food, [1005], "G"),
    fat: nutrient(food, [1004], "G"),
  };
  if (
    !Number.isSafeInteger(food.fdcId) ||
    !food.description ||
    Object.values(per100g).some((value) => value == null)
  )
    return null;
  const description = String(food.description).slice(0, 300);
  const lower = description.toLowerCase();
  const preparation = /\braw\b|\buncooked\b/.test(lower)
    ? "Crudo"
    : /\bfried\b/.test(lower)
      ? "Frito"
      : /\broasted\b/.test(lower)
        ? "Asado"
        : /\bgrilled\b/.test(lower)
          ? "A la parrilla"
          : /\bboiled\b/.test(lower)
            ? "Hervido"
            : /\bcooked\b|\bstewed\b/.test(lower)
              ? "Cocido"
              : "Revisar preparación";
  return {
    foodId: String(food.fdcId),
    description,
    preparation,
    per100g,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
  };
};
const findFoods = async (query) => {
  const cached = cache.get(query);
  if (cached?.expiresAt > Date.now()) return cached.foods;
  if (pending.has(query)) return pending.get(query);
  const key =
    process.env.USDA_API_KEY ||
    (process.env.NODE_ENV !== "production" ? "DEMO_KEY" : "");
  if (!key)
    throw error(
      "La búsqueda nutricional aún no está habilitada. Puedes ingresar los valores manualmente",
      503,
      "FOOD_API_NOT_CONFIGURED",
    );
  const operation = (async () => {
    let response;
    try {
      response = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            dataType: ["Foundation", "SR Legacy"],
            pageSize: 40,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw error(
        "No se pudo consultar el catálogo nutricional. Inténtalo nuevamente",
        502,
        "FOOD_API_UNAVAILABLE",
      );
    }
    if (!response.ok)
      throw error(
        response.status === 429
          ? "El catálogo alcanzó su límite de consultas. Espera e inténtalo nuevamente"
          : "El catálogo nutricional no está disponible",
        response.status === 429 ? 429 : 502,
        "FOOD_API_UNAVAILABLE",
      );
    let data;
    try {
      data = await response.json();
    } catch {
      throw error(
        "Respuesta inválida del catálogo nutricional",
        502,
        "FOOD_API_UNAVAILABLE",
      );
    }
    const foods = (Array.isArray(data.foods) ? data.foods : [])
      .map(normalizeUsdaFood)
      .filter(Boolean)
      .sort((a, b) => {
        const penalty = (food) =>
          /breaded|lunchmeat|tenders|roll,|with sauce|deli|prepackaged|oscar mayer|sliced|honey glazed/.test(
            food.description.toLowerCase(),
          ) && !/breaded|lunchmeat|tenders|sauce|deli|sliced/.test(query)
            ? 10
            : 0;
        return penalty(a) - penalty(b);
      })
      .slice(0, 8);
    cache.set(query, { foods, expiresAt: Date.now() + CACHE_MS });
    while (cache.size > 128) cache.delete(cache.keys().next().value);
    return foods;
  })().finally(() => pending.delete(query));
  pending.set(query, operation);
  return operation;
};
export const searchFoodNutrition = async (input) => {
  const { grams, food } = parseFoodQuantity(input);
  const query = translateFoodQuery(food);
  const foods = await findFoods(query);
  return {
    grams,
    query,
    demo: !process.env.USDA_API_KEY,
    source: "USDA FoodData Central",
    attributionUrl: "https://fdc.nal.usda.gov/",
    foods: foods.map((item) => ({
      ...item,
      name: `${food} · ${item.preparation}${/skinless|meat only/i.test(item.description) ? ", sin piel" : /meat and skin/i.test(item.description) ? ", con piel" : ""}`.slice(
        0,
        120,
      ),
      quantity: `${grams} g`,
      ...scaleNutrients(item.per100g, grams),
      nutritionSource: {
        provider: "usda",
        foodId: item.foodId,
        description: item.description,
        grams,
        per100g: item.per100g,
      },
    })),
  };
};
export const clearFoodNutritionCache = () => {
  cache.clear();
  pending.clear();
};
