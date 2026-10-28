import { jest } from "@jest/globals";
import {
  parseFoodQuantity,
  translateFoodQuery,
  normalizeUsdaFood,
  searchFoodNutrition,
  clearFoodNutritionCache,
  normalizeFoodPortions,
  getFoodPortions,
} from "../src/services/foodNutritionService.js";
const fixture = {
  fdcId: 1234,
  description: "Chicken, breast, boneless, skinless, raw",
  foodNutrients: [
    { nutrientId: 1008, value: 120, unitName: "KCAL" },
    { nutrientId: 1003, value: 22.5, unitName: "G" },
    { nutrientId: 1004, value: 2.5, unitName: "G" },
    { nutrientId: 1005, value: 0, unitName: "G" },
  ],
};
const previousKey = process.env.USDA_API_KEY;
const previousEnv = process.env.NODE_ENV;
beforeEach(() => {
  clearFoodNutritionCache();
  process.env.USDA_API_KEY = "test-key";
});

test("normalizes provider portion weights per unit without assuming egg size", () => {
  expect(
    normalizeFoodPortions({
      foodPortions: [
        { id: 1, amount: 2, gramWeight: 120, modifier: "large" },
        { id: 2, amount: 0, gramWeight: 50, modifier: "medium" },
        { id: 3, amount: 1, gramWeight: -20, modifier: "small" },
      ],
    }),
  ).toEqual([{ id: "1", label: "grande", gramWeight: 60 }]);
  expect(normalizeFoodPortions({})).toEqual([]);
});

test("caches and shares portion lookups and handles provider limits", async () => {
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        foodPortions: [{ id: 1, amount: 1, gramWeight: 50, modifier: "large" }],
      }),
    });
  const results = await Promise.all([
    getFoodPortions("1234"),
    getFoodPortions("1234"),
  ]);
  expect(results[0][0]).toMatchObject({ gramWeight: 50 });
  await getFoodPortions("1234");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue({ ok: false, status: 429 });
  await expect(getFoodPortions("2345")).rejects.toMatchObject({
    statusCode: 429,
  });
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.USDA_API_KEY;
  else process.env.USDA_API_KEY = previousKey;
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
});
test.each([
  "200g de pechuga de pollo",
  "200 gramos de pechuga de pollo",
  "pechuga de pollo 200 g",
  "0,2 kg de pechuga de pollo",
])("understands quantity and Spanish name in %s", (text) => {
  expect(parseFoodQuantity(text)).toEqual({
    grams: 200,
    food: "pechuga de pollo",
  });
  expect(translateFoodQuery(parseFoodQuantity(text).food)).toBe(
    "chicken breast",
  );
});
test.each([
  "-200g de pollo",
  "200g de pollo y 100g de arroz",
  "2 huevos",
  "200 g",
  "0g pollo",
])("rejects ambiguous or invalid portions: %s", (text) => {
  expect(() => parseFoodQuantity(text)).toThrow();
});
test("translates explicit preparation without inferring it", () => {
  expect(translateFoodQuery("pechuga de pollo cocida sin piel")).toBe(
    "chicken breast cooked skinless",
  );
  expect(translateFoodQuery("arroz integral crudo")).toBe("brown rice raw");
});
test("scales the real provider values by grams and reuses cached data for a new quantity", async () => {
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ foods: [fixture] }) });
  const first = await searchFoodNutrition("200g de pechuga de pollo");
  expect(first.foods[0]).toMatchObject({
    calories: 240,
    protein: 45,
    carbs: 0,
    fat: 5,
    quantity: "200 g",
    nutritionSource: { grams: 200, foodId: "1234" },
  });
  const next = await searchFoodNutrition("150g de pechuga de pollo");
  expect(next.foods[0]).toMatchObject({
    calories: 180,
    protein: 33.75,
    fat: 3.75,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("shares concurrent provider queries", async () => {
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ foods: [fixture] }) });
  await Promise.all([
    searchFoodNutrition("200g pollo"),
    searchFoodNutrition("100g pollo"),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("uses kcal-specific Atwater values and does not invent missing nutrients", () => {
  const atwater = {
    ...fixture,
    foodNutrients: fixture.foodNutrients
      .filter((n) => n.nutrientId !== 1008)
      .concat([
        { nutrientId: 2047, value: 110, unitName: "KCAL" },
        { nutrientId: 2048, value: 112, unitName: "KCAL" },
      ]),
  };
  expect(normalizeUsdaFood(atwater).per100g.calories).toBe(112);
  expect(normalizeUsdaFood({ ...fixture, foodNutrients: [] })).toBeNull();
  expect(
    normalizeUsdaFood({
      ...fixture,
      foodNutrients: fixture.foodNutrients.map((n) =>
        n.nutrientId === 1005 ? { ...n, value: -0.4 } : n,
      ),
    }),
  ).toBeNull();
});
test("requires a private API key in production and handles provider limits", async () => {
  delete process.env.USDA_API_KEY;
  process.env.NODE_ENV = "production";
  await expect(searchFoodNutrition("200g pollo")).rejects.toMatchObject({
    statusCode: 503,
    code: "FOOD_API_NOT_CONFIGURED",
  });
  process.env.USDA_API_KEY = "test-key";
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 429 });
  await expect(searchFoodNutrition("200g pollo")).rejects.toMatchObject({
    statusCode: 429,
  });
});
