import { Router } from "express";
import {
  ensureCanAccessOwner,
  protect,
} from "../middleware/authMiddleware.js";
import User from "../models/User.js";
import WeightEntry from "../models/WeightEntry.js";

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    throw invalidRequest(`La ${field} no es valida`);
  }
  return dateKey;
};

const shiftDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
};

const todayUtcKey = () => new Date().toISOString().slice(0, 10);

const resolveOwnerId = async (req, value) => {
  const ownerId = String(value || req.user.id).trim();
  if (!(await ensureCanAccessOwner(req, ownerId))) {
    const error = new Error("No autorizado para acceder a estos pesajes");
    error.statusCode = 403;
    throw error;
  }
  return ownerId;
};

const buildSummary = async (ownerId, todayKey) => {
  const [latestEntries, completedToday, total, recentDates] = await Promise.all([
    WeightEntry.find({ ownerId }).sort({ dateKey: -1 }).limit(2).lean(),
    WeightEntry.exists({ ownerId, dateKey: todayKey }),
    WeightEntry.countDocuments({ ownerId }),
    WeightEntry.find({ ownerId, dateKey: { $lte: todayKey } })
      .select("dateKey")
      .sort({ dateKey: -1 })
      .limit(366)
      .lean(),
  ]);

  const dateSet = new Set(recentDates.map((entry) => entry.dateKey));
  let cursor = completedToday ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  while (dateSet.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  const latest = latestEntries[0] || null;
  const previous = latestEntries[1] || null;
  return {
    todayKey,
    completedToday: Boolean(completedToday),
    latest,
    previous,
    changeKg:
      latest && previous
        ? Number((latest.weightKg - previous.weightKg).toFixed(1))
        : null,
    streak,
    total,
  };
};

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.query.athleteId);
    const todayKey = normalizeDateKey(
      req.query.today || todayUtcKey(),
      "fecha actual",
    );
    const from = normalizeDateKey(
      req.query.from || shiftDateKey(todayKey, -89),
      "fecha inicial",
    );
    const to = normalizeDateKey(req.query.to || todayKey, "fecha final");
    if (from > to) throw invalidRequest("El rango de fechas no es valido");

    const [entries, summary] = await Promise.all([
      WeightEntry.find({
        ownerId,
        dateKey: { $gte: from, $lte: to },
      })
        .sort({ dateKey: 1 })
        .limit(1000)
        .lean(),
      buildSummary(ownerId, todayKey),
    ]);

    res.set("Cache-Control", "private, no-store");
    res.json({ entries, summary });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.body.ownerId);
    const dateKey = normalizeDateKey(req.body.dateKey);
    const weightKg = Number(req.body.weightKg);
    if (!Number.isFinite(weightKg) || weightKg < 25 || weightKg > 400) {
      throw invalidRequest("El peso debe estar entre 25 y 400 kg");
    }
    const note = String(req.body.note || "").trim().slice(0, 160);
    const existed = await WeightEntry.exists({ ownerId, dateKey });
    const entry = await WeightEntry.findOneAndUpdate(
      { ownerId, dateKey },
      {
        $set: {
          weightKg: Math.round(weightKg * 10) / 10,
          note,
          recordedBy: req.user.id,
          source: ownerId === req.user.id ? "self" : "coach",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const latest = await WeightEntry.findOne({ ownerId })
      .sort({ dateKey: -1 })
      .select("weightKg")
      .lean();
    if (latest) {
      await User.findByIdAndUpdate(ownerId, {
        $set: { "profile.weight": latest.weightKg },
      });
    }

    res.status(existed ? 200 : 201).json(entry);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const entry = await WeightEntry.findById(req.params.id).lean();
    if (!entry) return res.status(404).json({ error: "Pesaje no encontrado" });
    if (!(await ensureCanAccessOwner(req, entry.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await WeightEntry.findByIdAndDelete(req.params.id);
    const latest = await WeightEntry.findOne({ ownerId: entry.ownerId })
      .sort({ dateKey: -1 })
      .select("weightKg")
      .lean();
    if (latest) {
      await User.findByIdAndUpdate(entry.ownerId, {
        $set: { "profile.weight": latest.weightKg },
      });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
