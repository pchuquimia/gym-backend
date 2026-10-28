import { Router } from "express";
import { body, param, query } from "express-validator";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import rateLimit from "express-rate-limit";
import {
  searchFoodNutrition,
  scaleNutrients,
  parseFoodQuantity,
  getFoodPortions,
} from "../services/foodNutritionService.js";
import User from "../models/User.js";
import NutritionPlan from "../models/NutritionPlan.js";
import NutritionDay from "../models/NutritionDay.js";

const router = Router();
router.use(protect);
router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { statusCode: status });
const normalizeFood = (food) => {
  const manual = {
    name: food.name,
    quantity: food.quantity,
    nutritionSource: null,
    ...Object.fromEntries(
      ["calories", "protein", "carbs", "fat"].map((key) => [
        key,
        food[key] == null ? null : Number(food[key]),
      ]),
    ),
  };
  if (!food.nutritionSource) return manual;
  const source = food.nutritionSource;
  const portion = source.portion;
  const grams = portion
    ? Math.round(portion.amount * portion.gramWeight * 1000) / 1000
    : parseFoodQuantity(`${food.quantity} alimento`).grams;
  if (portion && food.quantity !== `${portion.amount} × ${portion.label}`)
    throw fail("La cantidad no coincide con la medida seleccionada");
  if (grams !== Number(source.grams))
    throw fail(
      "La cantidad no coincide con los macros calculados. Recalcula el alimento",
    );
  const per100g = Object.fromEntries(
    ["calories", "protein", "carbs", "fat"].map((key) => [
      key,
      Number(source.per100g[key]),
    ]),
  );
  return {
    name: food.name,
    quantity: portion ? `${portion.amount} × ${portion.label}` : `${grams} g`,
    ...scaleNutrients(per100g, grams),
    nutritionSource: {
      provider: "usda",
      foodId: String(source.foodId),
      description: source.description,
      grams,
      per100g,
      ...(portion
        ? {
            portion: {
              amount: portion.amount,
              label: portion.label,
              gramWeight: portion.gramWeight,
            },
          }
        : {}),
    },
  };
};
const dateKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw fail("Fecha inválida");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw fail("Fecha inválida");
  return value;
};
const todayFor = (req) => {
  const timezone = req.query.timezone || req.body.timezone || "UTC";
  if (typeof timezone !== "string" || timezone.length > 100)
    throw fail("Zona horaria inválida");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    throw fail("Zona horaria inválida");
  }
};
const resolveScope = async (req, requestedId) => {
  const actor = await User.findOne(
    { _id: req.user.id, isActive: true },
    "role assignedTrainerId isDemo demoWorkspaceId",
  ).lean();
  if (!actor || actor.role !== req.user.role)
    throw fail("Cuenta no disponible", 403);
  const athleteId = String(requestedId || req.user.id);
  let athlete;
  if (actor.role === "Cliente") {
    if (athleteId !== req.user.id) throw fail("No autorizado", 403);
    athlete = actor;
  } else if (["Admin", "Entrenador"].includes(actor.role)) {
    if (!/^[a-f\d]{24}$/i.test(athleteId)) throw fail("Alumno inválido");
    athlete = await User.findOne({
      _id: athleteId,
      role: "Cliente",
      isActive: true,
      assignedTrainerId: req.user.id,
    }).lean();
    if (!athlete) throw fail("El alumno no está vinculado a tu cuenta", 403);
  } else {
    throw fail("No autorizado", 403);
  }
  if (!athlete.assignedTrainerId) return null;
  const coach = await User.findOne({
    _id: athlete.assignedTrainerId,
    role: { $in: ["Admin", "Entrenador"] },
    isActive: true,
  }).lean();
  if (
    !coach ||
    Boolean(coach.isDemo) !== Boolean(athlete.isDemo) ||
    (coach.isDemo && coach.demoWorkspaceId !== athlete.demoWorkspaceId)
  )
    return null;
  return { athleteId, coachId: String(coach._id) };
};
const getDay = async (scope, selectedDate) => {
  if (!scope) return { plan: null, day: null };
  const day = await NutritionDay.findOne({
    ...scope,
    dateKey: selectedDate,
  }).lean();
  if (day) return { plan: { _id: day.planId, content: day.snapshot }, day };
  const plan = await NutritionPlan.findOne({
    ...scope,
    startsOn: { $lte: selectedDate },
  })
    .sort({ startsOn: -1, _id: -1 })
    .lean();
  return { plan, day: null };
};

router.get(
  "/foods/search",
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { error: "Espera un momento antes de buscar más alimentos" },
  }),
  [
    query("q").isString().bail().trim().isLength({ min: 3, max: 200 }),
    validate,
  ],
  async (req, res, next) => {
    try {
      if (!["Admin", "Entrenador"].includes(req.user.role))
        throw fail("Solo el coach puede buscar alimentos para una dieta", 403);
      res.json(await searchFoodNutrition(req.query.q));
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/foods/:foodId/portions",
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
  }),
  [param("foodId").isInt({ min: 1 }), validate],
  async (req, res, next) => {
    try {
      if (!["Admin", "Entrenador"].includes(req.user.role))
        throw fail(
          "Solo el coach puede consultar las medidas de un alimento",
          403,
        );
      res.json({ portions: await getFoodPortions(req.params.foodId) });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/day", async (req, res, next) => {
  try {
    const today = todayFor(req);
    const selectedDate = dateKey(req.query.dateKey || today);
    const scope = await resolveScope(req, req.query.athleteId);
    const data = await getDay(scope, selectedDate);
    res.json({
      ...data,
      dateKey: selectedDate,
      today,
      canComplete:
        req.user.role === "Cliente" &&
        selectedDate <= today &&
        Boolean(scope && data.plan),
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/athletes/:athleteId",
  [param("athleteId").isMongoId(), validate],
  async (req, res, next) => {
    try {
      if (!["Admin", "Entrenador"].includes(req.user.role))
        throw fail("No autorizado", 403);
      const scope = await resolveScope(req, req.params.athleteId);
      if (!scope) throw fail("No hay una vinculación activa", 403);
      const today = todayFor(req);
      const [plans, daily, days] = await Promise.all([
        NutritionPlan.find(scope)
          .sort({ startsOn: -1, _id: -1 })
          .limit(12)
          .lean(),
        getDay(scope, today),
        NutritionDay.find({ ...scope, dateKey: { $lte: today } })
          .sort({ dateKey: -1 })
          .limit(14)
          .lean(),
      ]);
      res.json({ plans, daily: { ...daily, dateKey: today }, days });
    } catch (error) {
      next(error);
    }
  },
);

const textRule = (path, max, required = false) => {
  const rule = body(path);
  return (required ? rule : rule.optional())
    .isString()
    .bail()
    .trim()
    .isLength({ min: required ? 1 : 0, max });
};
router.post(
  "/athletes/:athleteId/plans",
  [
    param("athleteId").isMongoId(),
    textRule("name", 120, true),
    textRule("notes", 2000),
    body("startsOn").isString(),
    body("meals").isArray({ min: 1, max: 8 }),
    body("meals.*.mealId").isUUID(),
    textRule("meals.*.name", 80, true),
    textRule("meals.*.notes", 1000),
    body("meals.*.time")
      .optional()
      .matches(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/),
    body("meals.*.foods").isArray({ min: 1, max: 30 }),
    textRule("meals.*.foods.*.name", 120, true),
    textRule("meals.*.foods.*.quantity", 100, true),
    ...["calories", "protein", "carbs", "fat"].map((key) =>
      body(`meals.*.foods.*.${key}`)
        .optional({ nullable: true })
        .isFloat({ min: 0, max: 10000 }),
    ),
    body("meals.*.foods.*.nutritionSource")
      .optional({ nullable: true })
      .isObject()
      .bail()
      .custom(
        (source) =>
          source.provider === "usda" &&
          /^\d+$/.test(String(source.foodId)) &&
          typeof source.description === "string" &&
          source.description.length > 0 &&
          Number.isFinite(Number(source.grams)) &&
          source.grams > 0 &&
          ["calories", "protein", "carbs", "fat"].every(
            (key) =>
              typeof source.per100g?.[key] === "number" &&
              Number.isFinite(source.per100g[key]) &&
              source.per100g[key] >= 0,
          ),
      ),
    body("meals.*.foods.*.nutritionSource.provider").optional().equals("usda"),
    body("meals.*.foods.*.nutritionSource.portion")
      .optional()
      .custom(
        (portion) =>
          portion &&
          typeof portion.amount === "number" &&
          Number.isFinite(portion.amount) &&
          portion.amount >= 0.001 &&
          portion.amount <= 50000 &&
          typeof portion.gramWeight === "number" &&
          Number.isFinite(portion.gramWeight) &&
          portion.gramWeight >= 0.1 &&
          portion.gramWeight <= 5000 &&
          typeof portion.label === "string" &&
          portion.label.trim().length > 0 &&
          portion.label.length <= 80,
      ),
    body("meals.*.foods.*.nutritionSource.foodId").optional().isInt({ min: 1 }),
    body("meals.*.foods.*.nutritionSource.description")
      .optional()
      .isString()
      .isLength({ min: 1, max: 300 }),
    body("meals.*.foods.*.nutritionSource.grams")
      .optional()
      .isFloat({ min: 0.1, max: 5000 }),
    ...["calories", "protein", "carbs", "fat"].map((key) =>
      body(`meals.*.foods.*.nutritionSource.per100g.${key}`)
        .optional()
        .isFloat({ min: 0, max: 10000 }),
    ),
    validate,
  ],
  async (req, res, next) => {
    try {
      if (!["Admin", "Entrenador"].includes(req.user.role))
        throw fail("Solo tu coach puede asignar una dieta", 403);
      const scope = await resolveScope(req, req.params.athleteId);
      if (!scope) throw fail("No hay una vinculación activa", 403);
      const startsOn = dateKey(req.body.startsOn);
      const ids = req.body.meals.map((meal) => meal.mealId);
      if (new Set(ids).size !== ids.length)
        throw fail("Las comidas deben tener identificadores únicos");
      const content = {
        name: req.body.name,
        notes: req.body.notes || "",
        meals: req.body.meals.map((meal) => ({
          mealId: meal.mealId,
          name: meal.name,
          time: meal.time || "",
          notes: meal.notes || "",
          foods: meal.foods.map(normalizeFood),
        })),
      };
      const plan = await NutritionPlan.create({ ...scope, startsOn, content });
      res.status(201).json({ plan });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/day",
  [
    body("dateKey").isString(),
    body("planId").isMongoId(),
    body("mealId").isUUID(),
    body("completed").custom((value) => typeof value === "boolean"),
    validate,
  ],
  async (req, res, next) => {
    try {
      if (req.user.role !== "Cliente")
        throw fail("Solo el alumno puede marcar sus comidas", 403);
      const today = todayFor(req);
      const selectedDate = dateKey(req.body.dateKey);
      if (selectedDate > today)
        throw fail("No puedes completar comidas de días futuros");
      const scope = await resolveScope(req);
      const data = await getDay(scope, selectedDate);
      if (!scope || !data.plan)
        throw fail("No tienes un plan de alimentación para este día", 404);
      if (String(data.plan._id) !== req.body.planId)
        throw fail("El plan cambió. Actualiza tus comidas", 409);
      if (
        !data.plan.content.meals.some((meal) => meal.mealId === req.body.mealId)
      )
        throw fail("Comida no encontrada", 404);
      const operation = req.body.completed
        ? { $addToSet: { completedMealIds: req.body.mealId } }
        : { $pull: { completedMealIds: req.body.mealId } };
      let day;
      try {
        day = await NutritionDay.findOneAndUpdate(
          { ...scope, dateKey: selectedDate, planId: req.body.planId },
          {
            $setOnInsert: {
              ...scope,
              dateKey: selectedDate,
              planId: req.body.planId,
              snapshot: data.plan.content,
            },
            ...operation,
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          },
        ).lean();
      } catch (error) {
        if (error.code !== 11000) throw error;
        day = await NutritionDay.findOneAndUpdate(
          { ...scope, dateKey: selectedDate, planId: req.body.planId },
          operation,
          { new: true, runValidators: true },
        ).lean();
        if (!day)
          throw fail("El registro del día cambió. Actualiza tus comidas", 409);
      }
      res.json({
        day,
        plan: { _id: day.planId, content: day.snapshot },
        dateKey: selectedDate,
        today,
        canComplete: true,
      });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
