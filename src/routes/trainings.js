import { Router } from "express";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Training from "../models/Training.js";
import Preference from "../models/Preference.js";

const router = Router();

router.use(protect);

const toLocalISODate = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const offset = value.getTimezoneOffset() * 60000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  }
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 10);
    }
  } catch (_e) {
    return null;
  }
  return null;
};

const toIsoWeek = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
};

const getEntryVolume = (entry) => {
  if (!entry) return 0;
  const weight = Number(entry.weightKg ?? entry.weight ?? entry.kg ?? 0);
  const reps = Number(entry.reps ?? 0);
  return weight * reps;
};

const getSetVolume = (set) => {
  if (!set) return 0;
  const entries =
    Array.isArray(set.entries) && set.entries.length ? set.entries : null;
  if (entries)
    return entries.reduce((acc, entry) => acc + getEntryVolume(entry), 0);
  return getEntryVolume(set);
};

const getOrderContext = (plannedOrder, actualOrder, isExtra = false) => {
  if (isExtra) return "extra";
  if (!plannedOrder || !actualOrder) return "normal";
  if (actualOrder === 1) return plannedOrder === 1 ? "first" : "early";
  if (actualOrder === plannedOrder) return "normal";
  if (actualOrder < plannedOrder) return "early";
  return "fatigued";
};

const normalizeExerciseOrders = (exercises = []) =>
  Array.isArray(exercises)
    ? exercises.map((ex, idx) => {
        const actualOrder =
          Number(ex.actualOrder ?? ex.order ?? idx + 1) || idx + 1;
        const plannedOrder =
          Number(ex.plannedOrder ?? actualOrder) || actualOrder;
        return {
          ...ex,
          order: actualOrder,
          actualOrder,
          plannedOrder,
          orderContext:
            ex.orderContext ||
            getOrderContext(plannedOrder, actualOrder, Boolean(ex.isExtra)),
        };
      })
    : [];

const parseEventTime = (value) => {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
};

const normalizeTimeEvents = (events = []) =>
  Array.isArray(events)
    ? events
        .filter(
          (event) =>
            event?.type && event?.at && parseEventTime(event.at) != null,
        )
        .map((event) => ({
          type: event.type,
          at: new Date(parseEventTime(event.at)).toISOString(),
          exerciseId: event.exerciseId || null,
        }))
        .sort((a, b) => parseEventTime(a.at) - parseEventTime(b.at))
    : [];

const calculateTimingSummary = (events = []) => {
  let running = false;
  let activeExerciseId = null;
  let lastAt = null;
  let durationSeconds = 0;
  const exerciseMap = new Map();

  const accrue = (nextAt) => {
    if (!running || lastAt == null || nextAt <= lastAt) return;
    const delta = Math.floor((nextAt - lastAt) / 1000);
    if (delta <= 0) return;
    durationSeconds += delta;
    if (activeExerciseId) {
      exerciseMap.set(
        activeExerciseId,
        (exerciseMap.get(activeExerciseId) || 0) + delta,
      );
    }
  };

  normalizeTimeEvents(events).forEach((event) => {
    const at = parseEventTime(event.at);
    accrue(at);
    if (event.type === "session_start" || event.type === "session_resume") {
      running = true;
      lastAt = at;
      return;
    }
    if (event.type === "session_pause" || event.type === "session_end") {
      running = false;
      lastAt = at;
      return;
    }
    if (event.type === "exercise_start") {
      if (!running) running = true;
      activeExerciseId = event.exerciseId || null;
      lastAt = at;
    }
  });

  return {
    durationSeconds,
    exerciseDurations: Array.from(exerciseMap.entries()).map(
      ([exerciseId, seconds]) => ({
        exerciseId,
        durationSeconds: seconds,
      }),
    ),
  };
};

// GET /api/trainings/summary?from=&to=&routineId=
router.get("/summary", async (req, res, next) => {
  try {
    const { from, to, routineId } = req.query;
    const filter = await getAccessibleOwnerFilter(req);
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (routineId) filter.routineId = routineId;

    // Obtenemos las últimas 300 sesiones para el rango solicitado (suficiente para dashboard)
    const trainings = await Training.find(
      filter,
      "date routineId routineName branch routineBranch durationSeconds totalVolume exercises",
    )
      .sort({ date: -1 })
      .limit(300)
      .lean();

    // Volumen total y gráfica semanal
    const byWeek = new Map();
    let totalVolume = 0;
    trainings.forEach((t) => {
      const date = t.date || t.createdAt;
      if (!date) return;
      const vol =
        typeof t.totalVolume === "number"
          ? t.totalVolume
          : (t.exercises || []).reduce((acc, ex) => {
              const sets = Array.isArray(ex.sets) ? ex.sets : [];
              const v = sets.reduce((s, set) => s + getSetVolume(set), 0);
              return acc + v;
            }, 0);
      totalVolume += vol;
      const wk = toIsoWeek(date);
      if (!wk) return;
      byWeek.set(wk, (byWeek.get(wk) || 0) + vol);
    });

    const chart = Array.from(byWeek.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([x, y]) => ({ x, y }));

    const sessionsCount = trainings.length;

    // Objetivos desde preferencias
    let objectives = [];
    try {
      const pref = await Preference.findOne({ userId: req.user.id }).lean();
      if (pref?.goals) {
        objectives = Object.entries(pref.goals).map(([key, obj]) => ({
          key,
          label: obj.label || key,
          value: Number(obj.current) || 0,
          goal: Number(obj.target) || 0,
          unit: obj.unit || "kg",
        }));
      }
    } catch (_e) {
      objectives = [];
    }

    // Recent sessions ligeras
    const recentSessions = trainings.slice(0, 5).map((t) => ({
      id: t._id || t.id,
      date: t.date,
      routineId: t.routineId,
      routineName: t.routineName,
      branch: t.branch || t.routineBranch,
      totalVolume: t.totalVolume,
      durationSeconds: t.durationSeconds,
    }));

    res.set("Cache-Control", "public, max-age=120");
    res.json({
      chart,
      totalVolume,
      sessionsCount,
      prs: 0, // se puede calcular después con endpoint dedicado
      recentSessions,
      objectives,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trainings?page=1&limit=200&from=YYYY-MM-DD&to=YYYY-MM-DD&fields=date,routineName
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 2000, 1),
      5000,
    );
    const from = req.query.from;
    const to = req.query.to;
    const fields = req.query.fields
      ? req.query.fields.split(",").join(" ")
      : null; // null = all fields
    const routineId = req.query.routineId;

    const filter = await getAccessibleOwnerFilter(req);
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (routineId) {
      filter.routineId = routineId;
    }

    const trainings = await Training.find(filter, fields || undefined)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean();

    res.set("Cache-Control", "no-store");
    const includeMeta = req.query.meta === "true";
    if (includeMeta) {
      res.json({ page, limit, count: trainings.length, items: trainings });
    } else {
      res.json(trainings);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/trainings/:id
router.get("/:id", async (req, res, next) => {
  try {
    const fields = req.query.fields
      ? req.query.fields.split(",").join(" ")
      : undefined;
    const training = await Training.findById(req.params.id, fields).lean();
    if (!training) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, training.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    res.set("Cache-Control", "public, max-age=120");
    res.json(training);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = { ...req.body };
    const ownerId = payload.ownerId || req.user.id;
    if (!(await ensureCanAccessOwner(req, ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    payload.ownerId = ownerId;
    // si viene id, usarlo como _id; si no, dejar que el schema genere uno
    if (payload.id) payload._id = payload.id;
    delete payload.id;
    // normalizar fecha a string local yyyy-mm-dd para evitar corrimientos por zona horaria
    const normalizedDate = toLocalISODate(payload.date);
    payload.date = normalizedDate || toLocalISODate(new Date()) || payload.date;
    payload.exercises = normalizeExerciseOrders(payload.exercises);
    payload.timeEvents = normalizeTimeEvents(payload.timeEvents);
    const timingSummary = calculateTimingSummary(payload.timeEvents);
    if (timingSummary.durationSeconds > 0) {
      payload.durationSeconds = timingSummary.durationSeconds;
      payload.exerciseDurations = timingSummary.exerciseDurations;
    }
    // calcular volumen total si vienen sets
    const totalVolume =
      Array.isArray(payload.exercises) &&
      payload.exercises.reduce((acc, ex) => {
        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        const vol = sets.reduce((s, set) => s + getSetVolume(set), 0);
        return acc + vol;
      }, 0);
    payload.totalVolume = Number.isFinite(totalVolume) ? totalVolume : 0;

    const training = await Training.create(payload);
    res.status(201).json(training);
  } catch (err) {
    next(err);
  }
});

// PUT /api/trainings/:id
router.put("/:id", async (req, res, next) => {
  try {
    const payload = { ...req.body };
    const current = await Training.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    delete payload._id;
    delete payload.id;
    payload.ownerId = current.ownerId || req.user.id;
    if (req.body.ownerId && req.user.role === "Admin") {
      payload.ownerId = req.body.ownerId;
    }
    const normalizedDate = toLocalISODate(payload.date);
    payload.date = normalizedDate || payload.date;
    payload.exercises = normalizeExerciseOrders(payload.exercises);
    payload.timeEvents = normalizeTimeEvents(payload.timeEvents);
    const timingSummary = calculateTimingSummary(payload.timeEvents);
    if (timingSummary.durationSeconds > 0) {
      payload.durationSeconds = timingSummary.durationSeconds;
      payload.exerciseDurations = timingSummary.exerciseDurations;
    }
    const totalVolume =
      Array.isArray(payload.exercises) &&
      payload.exercises.reduce((acc, ex) => {
        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        const vol = sets.reduce((s, set) => s + getSetVolume(set), 0);
        return acc + vol;
      }, 0);
    payload.totalVolume = Number.isFinite(totalVolume) ? totalVolume : 0;
    const updated = await Training.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Training.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await Training.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
