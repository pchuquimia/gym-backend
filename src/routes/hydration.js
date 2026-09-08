import { Router } from "express";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import HydrationEntry from "../models/HydrationEntry.js";
import User from "../models/User.js";
import { deleteCacheByPrefix } from "../services/cacheService.js";

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GOAL_ML = 2500;

const invalidRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeDateKey = (value, field = "fecha") => {
  const dateKey = String(value || "").trim();
  if (!DATE_PATTERN.test(dateKey)) {
    throw invalidRequest(`La ${field} debe usar el formato YYYY-MM-DD`);
  }
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateKey
  ) {
    throw invalidRequest(`La ${field} no es válida`);
  }
  return dateKey;
};

const shiftDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
};

const resolveOwnerId = async (req, value) => {
  const ownerId = String(value || req.user.id).trim();
  if (!(await ensureCanAccessOwner(req, ownerId))) {
    const error = new Error("No autorizado para acceder a esta hidratación");
    error.statusCode = 403;
    throw error;
  }
  return ownerId;
};

const getGoalMl = (profile) => {
  const value = Number(profile?.hydrationGoalMl);
  return Number.isFinite(value) && value >= 500 && value <= 6000
    ? Math.round(value)
    : DEFAULT_GOAL_ML;
};

const buildDayRange = (from, to) => {
  const dates = [];
  let cursor = from;
  while (cursor <= to && dates.length < 370) {
    dates.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return dates;
};

const buildHydrationResponse = async ({ ownerId, from, to, selectedDate }) => {
  const [entries, owner] = await Promise.all([
    HydrationEntry.find({
      ownerId,
      dateKey: { $gte: from, $lte: to },
    })
      .sort({ dateKey: 1, createdAt: 1, _id: 1 })
      .limit(5000)
      .lean(),
    User.findById(ownerId).select("profile.hydrationGoalMl").lean(),
  ]);
  const goalMl = getGoalMl(owner?.profile);
  const totals = new Map();
  entries.forEach((entry) => {
    totals.set(entry.dateKey, (totals.get(entry.dateKey) || 0) + entry.amountMl);
  });
  const days = buildDayRange(from, to).map((dateKey) => {
    const totalMl = totals.get(dateKey) || 0;
    return {
      dateKey,
      totalMl,
      completed: totalMl >= goalMl,
      progress: Math.min(100, Math.round((totalMl / goalMl) * 100)),
    };
  });
  const selectedEntries = entries.filter(
    (entry) => entry.dateKey === selectedDate,
  );
  const totalMl = totals.get(selectedDate) || 0;
  const completedDates = new Set(
    days.filter((day) => day.completed).map((day) => day.dateKey),
  );
  let cursor = completedDates.has(selectedDate)
    ? selectedDate
    : shiftDateKey(selectedDate, -1);
  let streak = 0;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  const elapsedDays = days.filter((day) => day.dateKey <= selectedDate);
  const averageMl = elapsedDays.length
    ? Math.round(
        elapsedDays.reduce((sum, day) => sum + day.totalMl, 0) /
          elapsedDays.length,
      )
    : 0;

  return {
    entries,
    days,
    summary: {
      dateKey: selectedDate,
      totalMl,
      goalMl,
      remainingMl: Math.max(0, goalMl - totalMl),
      completed: totalMl >= goalMl,
      progress: Math.min(100, Math.round((totalMl / goalMl) * 100)),
      averageMl,
      streak,
      lastEntry: selectedEntries.at(-1) || null,
    },
  };
};

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.query.athleteId);
    const selectedDate = normalizeDateKey(
      req.query.date || new Date().toISOString().slice(0, 10),
      "fecha seleccionada",
    );
    const from = normalizeDateKey(
      req.query.from || shiftDateKey(selectedDate, -6),
      "fecha inicial",
    );
    const to = normalizeDateKey(req.query.to || selectedDate, "fecha final");
    if (from > to) throw invalidRequest("El rango de fechas no es válido");
    if (buildDayRange(from, to).length > 366) {
      throw invalidRequest("El rango máximo es de 366 días");
    }

    const response = await buildHydrationResponse({
      ownerId,
      from,
      to,
      selectedDate,
    });
    res.set("Cache-Control", "private, no-store");
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.body.ownerId);
    const dateKey = normalizeDateKey(req.body.dateKey);
    const amountMl = Number(req.body.amountMl);
    if (!Number.isFinite(amountMl) || amountMl < 50 || amountMl > 2000) {
      throw invalidRequest("La cantidad debe estar entre 50 y 2000 ml");
    }
    const entry = await HydrationEntry.create({
      ownerId,
      dateKey,
      amountMl: Math.round(amountMl),
      recordedBy: req.user.id,
      source: ownerId === req.user.id ? "self" : "coach",
    });
    await deleteCacheByPrefix(`dashboard:${ownerId}:`);
    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
});

router.post("/complete", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.body.ownerId);
    const dateKey = normalizeDateKey(req.body.dateKey);
    const [owner, totals] = await Promise.all([
      User.findById(ownerId).select("profile.hydrationGoalMl").lean(),
      HydrationEntry.aggregate([
        { $match: { ownerId, dateKey } },
        { $group: { _id: null, totalMl: { $sum: "$amountMl" } } },
      ]),
    ]);
    const goalMl = getGoalMl(owner?.profile);
    const totalMl = Number(totals[0]?.totalMl || 0);
    const remainingMl = Math.max(0, goalMl - totalMl);
    let entry = null;

    if (remainingMl >= 50) {
      entry = await HydrationEntry.create({
        ownerId,
        dateKey,
        amountMl: remainingMl,
        recordedBy: req.user.id,
        source: ownerId === req.user.id ? "self" : "coach",
      });
      await deleteCacheByPrefix(`dashboard:${ownerId}:`);
    }

    res.status(entry ? 201 : 200).json({
      completed: true,
      amountMl: entry?.amountMl || 0,
      totalMl: Math.max(totalMl, goalMl),
      goalMl,
      entry,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/goal", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.body.ownerId);
    const goalMl = Number(req.body.goalMl);
    if (!Number.isFinite(goalMl) || goalMl < 500 || goalMl > 6000) {
      throw invalidRequest("La meta debe estar entre 500 y 6000 ml");
    }
    await User.findByIdAndUpdate(ownerId, {
      $set: { "profile.hydrationGoalMl": Math.round(goalMl / 50) * 50 },
    });
    await deleteCacheByPrefix(`dashboard:${ownerId}:`);
    res.json({ goalMl: Math.round(goalMl / 50) * 50 });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const entry = await HydrationEntry.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ error: "Registro de agua no encontrado" });
    }
    if (!(await ensureCanAccessOwner(req, entry.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await HydrationEntry.findByIdAndDelete(req.params.id);
    await deleteCacheByPrefix(`dashboard:${entry.ownerId}:`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
