import { jest } from "@jest/globals";
import { clearFoodNutritionCache } from "../../src/services/foodNutritionService.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";
import User from "../../src/models/User.js";
import NutritionPlan from "../../src/models/NutritionPlan.js";
import NutritionDay from "../../src/models/NutritionDay.js";
import { deleteAccountData } from "../../src/services/accountDeletionService.js";
import { resetAuthenticationUserCache } from "../../src/services/authenticationUserCache.js";
let database, coach, athlete, outsider;
const secret = process.env.JWT_SECRET;
const today = () => new Date().toISOString().slice(0, 10);
const nextDay = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const account = (extra = {}) =>
  User.create({
    name: "Nutrition Test",
    email: `${crypto.randomUUID()}@example.invalid`,
    password: crypto.randomBytes(32).toString("hex"),
    activeSessions: [{ sessionId: "nutrition-test" }],
    ...extra,
  });
const auth = (user) =>
  `Bearer ${jwt.sign({ id: user.id, sid: "nutrition-test" }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
const payload = () => ({
  name: "Plan de prueba",
  startsOn: today(),
  notes: "Indicaciones del coach",
  meals: [
    {
      mealId: crypto.randomUUID(),
      name: "Desayuno",
      time: "08:00",
      foods: [
        {
          name: "Preparación del coach",
          quantity: "1 porción",
          calories: 300,
          protein: 20,
          carbs: 40,
          fat: 6,
        },
      ],
    },
    {
      mealId: crypto.randomUUID(),
      name: "Almuerzo",
      foods: [{ name: "Otra preparación", quantity: "1 porción" }],
    },
  ],
});
const create = (user, body, target = athlete) =>
  request(app)
    .post(`/api/nutrition/athletes/${target.id}/plans`)
    .set("Authorization", auth(user))
    .send(body);
const day = (user, date = today(), extra = "") =>
  request(app)
    .get(`/api/nutrition/day?dateKey=${date}&timezone=UTC${extra}`)
    .set("Authorization", auth(user));
const complete = (user, plan, mealId, completed = true, date = today()) =>
  request(app)
    .patch("/api/nutrition/day")
    .set("Authorization", auth(user))
    .send({
      dateKey: date,
      timezone: "UTC",
      planId: plan._id,
      mealId,
      completed,
    });
beforeAll(async () => {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1, ip: "127.0.0.1" },
  });
  await mongoose.connect(database.getUri("rirfit_nutrition_test"));
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
});
beforeEach(async () => {
  resetAuthenticationUserCache();
  for (const model of Object.values(mongoose.models))
    await model.deleteMany({});
  coach = await account({ role: "Entrenador" });
  athlete = await account({
    assignedTrainerId: coach.id,
    trainingMode: "coach_managed",
  });
  outsider = await account({ role: "Entrenador" });
});

test("coach assigns complete meals and athlete completes and unchecks a meal", async () => {
  const body = payload();
  const plan = (await create(coach, body).expect(201)).body.plan;
  const response = (await day(athlete).expect(200)).body;
  expect(response.plan.content.meals).toHaveLength(2);
  expect(response.plan.content.meals[1].foods[0].calories).toBeNull();
  expect(response.canComplete).toBe(true);
  await complete(athlete, plan, body.meals[0].mealId).expect(200);
  await complete(athlete, plan, body.meals[0].mealId).expect(200);
  expect((await day(athlete).expect(200)).body.day.completedMealIds).toEqual([
    body.meals[0].mealId,
  ]);
  await complete(athlete, plan, body.meals[0].mealId, false).expect(200);
  expect((await day(athlete).expect(200)).body.day.completedMealIds).toEqual(
    [],
  );
});

test("completion belongs to the selected day and future dates cannot be completed", async () => {
  const plan = (await create(coach, payload()).expect(201)).body.plan;
  await complete(athlete, plan, plan.content.meals[0].mealId).expect(200);
  const tomorrow = (await day(athlete, nextDay()).expect(200)).body;
  expect(tomorrow.day).toBeNull();
  expect(tomorrow.canComplete).toBe(false);
  await complete(
    athlete,
    plan,
    plan.content.meals[0].mealId,
    true,
    nextDay(),
  ).expect(400);
});

test("a new plan preserves snapshots and completion already recorded for a day", async () => {
  const original = (await create(coach, payload()).expect(201)).body.plan;
  await complete(athlete, original, original.content.meals[0].mealId).expect(
    200,
  );
  const changed = payload();
  changed.name = "Plan actualizado";
  await create(coach, changed).expect(201);
  const current = (await day(athlete).expect(200)).body;
  expect(current.plan._id).toBe(original._id);
  expect(current.plan.content.name).toBe("Plan de prueba");
  expect(current.day.completedMealIds).toEqual([
    original.content.meals[0].mealId,
  ]);
  expect(
    (await day(athlete, nextDay()).expect(200)).body.plan.content.name,
  ).toBe("Plan actualizado");
});

test("scheduled plans do not replace today's meals prematurely", async () => {
  await create(coach, payload()).expect(201);
  const scheduled = payload();
  scheduled.startsOn = nextDay();
  scheduled.name = "Dieta de mañana";
  await create(coach, scheduled).expect(201);
  expect((await day(athlete).expect(200)).body.plan.content.name).toBe(
    "Plan de prueba",
  );
  expect(
    (await day(athlete, nextDay()).expect(200)).body.plan.content.name,
  ).toBe("Dieta de mañana");
});

test("only the linked coach can author plans, and only the athlete records completion", async () => {
  const plan = (await create(coach, payload()).expect(201)).body.plan;
  await create(athlete, payload()).expect(403);
  await create(outsider, payload()).expect(403);
  await day(outsider, today(), `&athleteId=${athlete.id}`).expect(403);
  const admin = await account({ role: "Admin" });
  await day(admin, today(), `&athleteId=${athlete.id}`).expect(403);
  await complete(coach, plan, plan.content.meals[0].mealId).expect(403);
  await day(athlete, today(), `&athleteId=${coach.id}`).expect(403);
  await request(app).get("/api/nutrition/day").expect(401);
});

test("ending a relationship immediately blocks the old coach and hides their plan", async () => {
  await create(coach, payload()).expect(201);
  await day(athlete).expect(200);
  await User.updateOne(
    { _id: athlete.id },
    { $set: { assignedTrainerId: null } },
  );
  await day(coach, today(), `&athleteId=${athlete.id}`).expect(403);
  expect((await day(athlete).expect(200)).body.plan).toBeNull();
});

test("simultaneous meal checks keep both completions without duplicating daily records", async () => {
  const plan = (await create(coach, payload()).expect(201)).body.plan;
  const results = await Promise.all(
    plan.content.meals.map((meal) => complete(athlete, plan, meal.mealId)),
  );
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  expect(await NutritionDay.countDocuments({ athleteId: athlete.id })).toBe(1);
  expect(
    (await day(athlete).expect(200)).body.day.completedMealIds.sort(),
  ).toEqual(plan.content.meals.map((meal) => meal.mealId).sort());
});

test("validates meals, quantities, dates, nutrients and strict boolean completion", async () => {
  const empty = payload();
  empty.meals = [];
  await create(coach, empty).expect(400);
  const duplicate = payload();
  duplicate.meals[1].mealId = duplicate.meals[0].mealId;
  await create(coach, duplicate).expect(400);
  const invalid = payload();
  invalid.meals[0].foods[0].calories = -1;
  await create(coach, invalid).expect(400);
  const badDate = payload();
  badDate.startsOn = "2026-02-30";
  await create(coach, badDate).expect(400);
  const plan = (await create(coach, payload()).expect(201)).body.plan;
  await complete(athlete, plan, plan.content.meals[0].mealId, "false").expect(
    400,
  );
  await complete(athlete, plan, crypto.randomUUID()).expect(404);
  await day(athlete, "2026-02-30").expect(400);
  await day(athlete, today(), "&timezone=bad-timezone").expect(400);
});

test("coach can inspect adherence and deleting the athlete removes nutrition data", async () => {
  const plan = (await create(coach, payload()).expect(201)).body.plan;
  await complete(athlete, plan, plan.content.meals[0].mealId).expect(200);
  const response = await request(app)
    .get(`/api/nutrition/athletes/${athlete.id}?timezone=UTC`)
    .set("Authorization", auth(coach))
    .expect(200);
  expect(response.body.daily.day.completedMealIds).toHaveLength(1);
  expect(response.body.days).toHaveLength(1);
  await deleteAccountData(athlete.id);
  expect(await NutritionPlan.countDocuments({ athleteId: athlete.id })).toBe(0);
  expect(await NutritionDay.countDocuments({ athleteId: athlete.id })).toBe(0);
});

test("food lookup is restricted to coaches and plan snapshots preserve scaled nutrients and source", async () => {
  clearFoodNutritionCache();
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      foods: [
        {
          fdcId: 1234,
          description: "Chicken breast, raw",
          foodNutrients: [
            { nutrientId: 1008, value: 120, unitName: "KCAL" },
            { nutrientId: 1003, value: 22.5, unitName: "G" },
            { nutrientId: 1004, value: 2.5, unitName: "G" },
            { nutrientId: 1005, value: 0, unitName: "G" },
          ],
        },
      ],
    }),
  });
  const path =
    "/api/nutrition/foods/search?q=" +
    encodeURIComponent("200g de pechuga de pollo");
  await request(app).get(path).set("Authorization", auth(athlete)).expect(403);
  const response = await request(app)
    .get(path)
    .set("Authorization", auth(coach))
    .expect(200);
  const food = response.body.foods[0];
  expect(food.protein).toBe(45);
  const body = payload();
  body.meals[0].foods = [food];
  const plan = (await create(coach, body).expect(201)).body.plan;
  expect(plan.content.meals[0].foods[0].nutritionSource.foodId).toBe("1234");
  await complete(athlete, plan, plan.content.meals[0].mealId).expect(200);
  expect(
    (await day(athlete).expect(200)).body.day.snapshot.meals[0].foods[0]
      .protein,
  ).toBe(45);
  food.quantity = "150 g";
  await create(coach, body).expect(400);
});

test("unit quantities survive assignment and daily snapshots and reject inconsistent conversions", async () => {
  const body = payload();
  const food = {
    name: "Huevos",
    quantity: "5 × huevo grande",
    calories: 1,
    nutritionSource: {
      provider: "usda",
      foodId: "1234",
      description: "Egg, whole, raw",
      grams: 250,
      per100g: { calories: 140, protein: 12, carbs: 1, fat: 10 },
      portion: { amount: 5, label: "huevo grande", gramWeight: 50 },
    },
  };
  body.meals[0].foods = [food];
  const plan = (await create(coach, body).expect(201)).body.plan;
  expect(plan.content.meals[0].foods[0]).toMatchObject({
    quantity: "5 × huevo grande",
    calories: 350,
    protein: 30,
    nutritionSource: { grams: 250, portion: food.nutritionSource.portion },
  });
  await complete(athlete, plan, body.meals[0].mealId).expect(200);
  const snapshot = (await day(athlete).expect(200)).body.day.snapshot.meals[0]
    .foods[0];
  expect(snapshot.quantity).toBe("5 × huevo grande");
  expect(snapshot.nutritionSource.portion.amount).toBe(5);
  food.quantity = "10 × huevo grande";
  await create(coach, body).expect(400);
  food.quantity = "5 × huevo grande";
  food.nutritionSource.grams = 100;
  await create(coach, body).expect(400);
  food.nutritionSource.grams = 250;
  food.nutritionSource.portion.amount = -5;
  await create(coach, body).expect(400);
});

test("only coaches can load available food measures", async () => {
  clearFoodNutritionCache();
  jest
    .spyOn(global, "fetch")
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        foodPortions: [{ id: 1, amount: 1, gramWeight: 50, modifier: "large" }],
      }),
    });
  const path = "/api/nutrition/foods/1234/portions";
  await request(app).get(path).set("Authorization", auth(athlete)).expect(403);
  const response = await request(app)
    .get(path)
    .set("Authorization", auth(coach))
    .expect(200);
  expect(response.body.portions).toEqual([
    { id: "1", label: "grande", gramWeight: 50 },
  ]);
});
