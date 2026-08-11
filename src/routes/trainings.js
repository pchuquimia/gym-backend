import { Router } from "express";
import {
  authorizeRoles,
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Training from "../models/Training.js";
import Exercise from "../models/Exercise.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";
import {
  classifyExerciseLoad,
  getTrainingLoadMetrics,
} from "../utils/trainingLoad.js";

const router = Router();

router.use(protect);

const canMutateTraining = async (req, training) => {
  if (!training?.ownerId) return false;
  if (String(training.ownerId) === String(req.user.id)) return true;
  if (!(await ensureCanAccessOwner(req, training.ownerId))) return false;
  return (
    ["Admin", "Entrenador"].includes(req.user.role) &&
    training.sessionType === "supervised" &&
    String(training.supervisedBy || "") === String(req.user.id)
  );
};

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

const enrichTrainingExercises = async (exercises = []) => {
  if (!Array.isArray(exercises) || !exercises.length) return [];
  const ids = Array.from(
    new Set(exercises.map((exercise) => String(exercise.exerciseId || "")).filter(Boolean)),
  );
  const catalog = ids.length
    ? await Exercise.find(
        { _id: { $in: ids } },
        "_id primaryMuscleGroup primaryMuscles secondaryMuscles stabilizerMuscles equipment loadType name",
      ).lean()
    : [];
  const byId = new Map(catalog.map((exercise) => [String(exercise._id), exercise]));

  return exercises.map((exercise) => {
    const metadata = byId.get(String(exercise.exerciseId || "")) || {};
    const enriched = {
      ...exercise,
      primaryMuscleGroup:
        exercise.primaryMuscleGroup ||
        metadata.primaryMuscleGroup ||
        exercise.muscleGroup ||
        "",
      primaryMuscles:
        exercise.primaryMuscles?.length
          ? exercise.primaryMuscles
          : metadata.primaryMuscles || [],
      secondaryMuscles:
        exercise.secondaryMuscles?.length
          ? exercise.secondaryMuscles
          : metadata.secondaryMuscles || [],
      stabilizerMuscles:
        exercise.stabilizerMuscles?.length
          ? exercise.stabilizerMuscles
          : metadata.stabilizerMuscles || [],
      equipment:
        exercise.equipment?.length ? exercise.equipment : metadata.equipment || [],
      loadType: exercise.loadType || metadata.loadType || "",
    };
    enriched.loadType = classifyExerciseLoad({
      ...metadata,
      ...enriched,
      exerciseName: exercise.exerciseName || metadata.name,
    });
    return enriched;
  });
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
    ? exercises
        .map((ex, idx) => {
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
        .sort(
          (a, b) =>
            a.actualOrder - b.actualOrder || a.plannedOrder - b.plannedOrder,
        )
    : [];

const buildOrderSignature = (exercises = []) =>
  (Array.isArray(exercises) ? exercises : [])
    .map((exercise) => exercise.exerciseId || "")
    .filter(Boolean)
    .join("|");

const resolveTrainingProgressScope = async (req, payload, current = null) => {
  if (current?.progressScopeId) return current.progressScopeId;
  if (!payload.routineId) return "";

  const routine = await Routine.findById(
    payload.routineId,
    "ownerId progressScopeId",
  ).lean();
  if (!routine?.progressScopeId) return "";
  if (!(await ensureCanAccessOwner(req, routine.ownerId || payload.ownerId))) {
    return "";
  }
  return routine.progressScopeId;
};

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
  let resting = false;
  let activeExerciseId = null;
  let lastAt = null;
  let pauseStartedAt = null;
  let durationSeconds = 0;
  let restSeconds = 0;
  let pauseSeconds = 0;
  const exerciseMap = new Map();
  const exerciseRestMap = new Map();
  const normalizedEvents = normalizeTimeEvents(events);
  const hasRestEvents = normalizedEvents.some((event) =>
    ["rest_start", "rest_end"].includes(event.type),
  );

  const accrue = (nextAt) => {
    if (!running || lastAt == null || nextAt <= lastAt) return;
    const delta = Math.floor((nextAt - lastAt) / 1000);
    if (delta <= 0) return;
    durationSeconds += delta;
    if (resting) restSeconds += delta;
    if (activeExerciseId) {
      exerciseMap.set(
        activeExerciseId,
        (exerciseMap.get(activeExerciseId) || 0) + delta,
      );
      if (resting) {
        exerciseRestMap.set(
          activeExerciseId,
          (exerciseRestMap.get(activeExerciseId) || 0) + delta,
        );
      }
    }
  };

  normalizedEvents.forEach((event) => {
    const at = parseEventTime(event.at);
    accrue(at);
    if (event.type === "session_start" || event.type === "session_resume") {
      if (pauseStartedAt != null && at > pauseStartedAt) {
        pauseSeconds += Math.floor((at - pauseStartedAt) / 1000);
      }
      running = true;
      resting = false;
      pauseStartedAt = null;
      lastAt = at;
      return;
    }
    if (event.type === "session_pause" || event.type === "session_end") {
      if (pauseStartedAt != null && at > pauseStartedAt) {
        pauseSeconds += Math.floor((at - pauseStartedAt) / 1000);
      }
      running = false;
      resting = false;
      pauseStartedAt = event.type === "session_pause" ? at : null;
      lastAt = at;
      return;
    }
    if (event.type === "exercise_start") {
      if (!running) running = true;
      activeExerciseId = event.exerciseId || null;
      lastAt = at;
      return;
    }
    if (event.type === "rest_start" && running) {
      resting = true;
      lastAt = at;
      return;
    }
    if (event.type === "rest_end") {
      resting = false;
      lastAt = at;
    }
  });

  return {
    durationSeconds,
    workSeconds: hasRestEvents
      ? Math.max(0, durationSeconds - restSeconds)
      : null,
    restSeconds: hasRestEvents ? restSeconds : null,
    pauseSeconds,
    hasRestEvents,
    exerciseDurations: Array.from(exerciseMap.entries()).map(
      ([exerciseId, seconds]) => {
        const exerciseRestSeconds = exerciseRestMap.get(exerciseId) || 0;
        return {
          exerciseId,
          durationSeconds: seconds,
          workSeconds: hasRestEvents
            ? Math.max(0, seconds - exerciseRestSeconds)
            : null,
          restSeconds: hasRestEvents ? exerciseRestSeconds : null,
        };
      },
    ),
  };
};

// GET /api/trainings/routine-counts
router.get("/routine-counts", async (req, res, next) => {
  try {
    const ownerFilter = await getAccessibleOwnerFilter(req);
    const counts = await Training.aggregate([
      {
        $match: {
          ...ownerFilter,
          routineId: { $type: "string", $ne: "" },
        },
      },
      {
        $group: {
          _id: "$routineId",
          count: { $sum: 1 },
          lastPerformedAt: { $max: "$date" },
        },
      },
      { $sort: { count: -1, _id: 1 } },
    ]);

    res.set("Cache-Control", "private, no-store");
    res.json(
      counts.map((item) => ({
        routineId: item._id,
        count: item.count,
        lastPerformedAt: item.lastPerformedAt || null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

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
      const vol = getTrainingLoadMetrics(t.exercises).recordedKg;
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

    res.set("Cache-Control", "private, no-store");
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
    const progressScopeId = req.query.progressScopeId;
    const excludeProgressScopeId = req.query.excludeProgressScopeId;

    const filter = await getAccessibleOwnerFilter(req);
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (routineId) {
      filter.routineId = routineId;
    }
    if (progressScopeId || excludeProgressScopeId) {
      filter.progressScopeId = {};
      if (progressScopeId) filter.progressScopeId.$eq = progressScopeId;
      if (excludeProgressScopeId)
        filter.progressScopeId.$ne = excludeProgressScopeId;
    }

    const trainings = await Training.find(filter, fields || undefined)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean();

    res.set("Cache-Control", "no-store");
    const localizedTrainings = await localizeExerciseReferences(
      trainings,
      getExerciseLanguage(req),
    );
    const includeMeta = req.query.meta === "true";
    if (includeMeta) {
      res.json({
        page,
        limit,
        count: localizedTrainings.length,
        items: localizedTrainings,
      });
    } else {
      res.json(localizedTrainings);
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
    res.set("Cache-Control", "private, no-store");
    res.json(
      await localizeExerciseReferences(training, getExerciseLanguage(req)),
    );
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
    if (payload.routineId) {
      const routine = await Routine.findOne({
        _id: payload.routineId,
        ownerId,
        isArchived: { $ne: true },
      }).lean();
      if (!routine) {
        return res.status(400).json({
          error: "La rutina ya no esta disponible para entrenar",
        });
      }
    }
    let linkedPlan = null;
    let linkedPlanSlot = null;
    let linkedPlanSlotIndex = -1;
    if (payload.trainingPlanId || payload.trainingPlanSlotId) {
      linkedPlan = await TrainingPlan.findOne({
        _id: payload.trainingPlanId,
        athleteId: ownerId,
        status: "active",
        "weeklySchedule.slotId": payload.trainingPlanSlotId,
      }).lean();
      if (!linkedPlan) {
        return res.status(400).json({
          error: "El bloque seleccionado no pertenece al plan vigente",
        });
      }
      linkedPlanSlotIndex = (linkedPlan.weeklySchedule || []).findIndex(
        (day) => day.slotId === payload.trainingPlanSlotId,
      );
      linkedPlanSlot = linkedPlan.weeklySchedule?.[linkedPlanSlotIndex];
      if (
        !linkedPlanSlot ||
        linkedPlanSlot.type !== "training" ||
        String(linkedPlanSlot.routineId) !== String(payload.routineId)
      ) {
        return res.status(400).json({
          error: "La rutina no corresponde al bloque seleccionado",
        });
      }
    }
    const isSupervised = ownerId !== req.user.id;
    payload.sessionType = isSupervised ? "supervised" : "personal";
    payload.startedBy = req.user.id;
    payload.supervisedBy = isSupervised ? req.user.id : null;
    // si viene id, usarlo como _id; si no, dejar que el schema genere uno
    if (payload.id) payload._id = payload.id;
    delete payload.id;
    delete payload.durationOverrideSeconds;
    // normalizar fecha a string local yyyy-mm-dd para evitar corrimientos por zona horaria
    const normalizedDate = toLocalISODate(payload.date);
    payload.date = normalizedDate || toLocalISODate(new Date()) || payload.date;
    if (linkedPlan && linkedPlanSlot) {
      const date = new Date(`${payload.date}T00:00:00Z`);
      const mondayDayIndex = ((date.getUTCDay() + 6) % 7) + 1;
      const expectedCycleIndex = Number(
        linkedPlan.cycleProgress?.currentIndex || 0,
      );
      const requiresAcknowledgement =
        (linkedPlan.scheduleMode === "fixed" &&
          Number(linkedPlanSlot.dayIndex) !== mondayDayIndex) ||
        (linkedPlan.scheduleMode !== "fixed" &&
          linkedPlanSlotIndex !== expectedCycleIndex);
      if (requiresAcknowledgement && !payload.scheduleOverride?.acknowledged) {
        return res.status(409).json({
          error: "Confirma que deseas entrenar un dia distinto al planificado",
        });
      }
      payload.scheduleOverride = requiresAcknowledgement
        ? {
            acknowledged: true,
            scheduledDate: String(
              payload.scheduleOverride?.scheduledDate || "",
            ).slice(0, 10),
            actualDate: payload.date,
            selectedDayIndex: Number(linkedPlanSlot.dayIndex) || null,
            scheduleMode: linkedPlan.scheduleMode,
            acknowledgedAt:
              payload.scheduleOverride?.acknowledgedAt ||
              new Date().toISOString(),
          }
        : undefined;
    } else {
      payload.scheduleOverride = undefined;
    }
    payload.progressScopeId = await resolveTrainingProgressScope(req, payload);
    payload.exercises = normalizeExerciseOrders(
      await enrichTrainingExercises(payload.exercises),
    );
    payload.orderSignature =
      String(payload.orderSignature || "").trim() ||
      buildOrderSignature(payload.exercises);
    payload.timeEvents = normalizeTimeEvents(payload.timeEvents);
    const timingSummary = calculateTimingSummary(payload.timeEvents);
    if (timingSummary.durationSeconds > 0) {
      payload.durationSeconds = timingSummary.durationSeconds;
      payload.exerciseDurations = timingSummary.exerciseDurations;
    }
    payload.workSeconds = timingSummary.workSeconds;
    payload.restSeconds = timingSummary.restSeconds;
    payload.pauseSeconds = timingSummary.pauseSeconds;
    const loadMetrics = getTrainingLoadMetrics(payload.exercises);
    payload.totalVolume = loadMetrics.recordedKg;
    payload.volumeBreakdown = loadMetrics;

    let training;
    try {
      training = await Training.create(payload);
    } catch (createError) {
      if (createError?.code === 11000 && payload._id) {
        const existing = await Training.findOne({
          _id: String(payload._id),
          ownerId,
        });
        if (existing) {
          res.set("Idempotent-Replay", "true");
          return res.status(200).json(existing);
        }
      }
      throw createError;
    }
    if (payload.routineId) {
      try {
        const plan = payload.trainingPlanId
          ? await TrainingPlan.findOne({
              _id: payload.trainingPlanId,
              athleteId: ownerId,
              status: "active",
              scheduleMode: {
                $in: ["flexible_guided", "sequential_cycle"],
              },
            })
          : await TrainingPlan.findOne({
              athleteId: ownerId,
              status: "active",
              scheduleMode: {
                $in: ["flexible_guided", "sequential_cycle"],
              },
              "weeklySchedule.routineId": payload.routineId,
            });
        const schedule = plan?.weeklySchedule || [];
        const currentIndex = Number(plan?.cycleProgress?.currentIndex || 0);
        const selectedIndex = payload.trainingPlanSlotId
          ? schedule.findIndex(
              (day) => day.slotId === payload.trainingPlanSlotId,
            )
          : currentIndex;
        const selected = schedule[selectedIndex];
        const acceptedOverride = Boolean(payload.scheduleOverride?.acknowledged);
        if (
          plan &&
          selected?.type === "training" &&
          (payload.trainingPlanSlotId
            ? selected.slotId === payload.trainingPlanSlotId
            : String(selected.routineId) === String(payload.routineId)) &&
          (selectedIndex === currentIndex || acceptedOverride) &&
          plan.cycleProgress?.lastTrainingId !== String(training._id)
        ) {
          const nextIndex = (selectedIndex + 1) % schedule.length;
          plan.cycleProgress = plan.cycleProgress || {};
          plan.cycleProgress.currentIndex = nextIndex;
          plan.cycleProgress.completedCycles =
            Number(plan.cycleProgress.completedCycles || 0) +
            (nextIndex === 0 ? 1 : 0);
          plan.cycleProgress.lastAdvancedAt = new Date();
          plan.cycleProgress.lastTrainingId = String(training._id);
          await plan.save();
        }
      } catch (cycleError) {
        console.error(
          "No se pudo avanzar el ciclo de entrenamiento",
          cycleError,
        );
      }
    }
    res.status(201).json(training);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/duration",
  authorizeRoles("Admin"),
  async (req, res, next) => {
    try {
      const durationSeconds = Number(req.body.durationSeconds);
      if (
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 0 ||
        durationSeconds > 86400
      ) {
        return res.status(400).json({
          error: "La duración debe estar entre 0 y 86400 segundos",
        });
      }
      const current = await Training.findById(
        req.params.id,
        "ownerId sessionType supervisedBy",
      ).lean();
      if (!current) return res.status(404).json({ error: "Not found" });
      if (!(await canMutateTraining(req, current))) {
        return res.status(403).json({ error: "No autorizado" });
      }
      const training = await Training.findByIdAndUpdate(
        req.params.id,
        { durationSeconds, durationOverrideSeconds: durationSeconds },
        { new: true, runValidators: true },
      );
      res.json(training);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/trainings/:id
router.put("/:id", async (req, res, next) => {
  try {
    const payload = { ...req.body };
    const current = await Training.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await canMutateTraining(req, current))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    delete payload._id;
    delete payload.id;
    delete payload.durationOverrideSeconds;
    payload.ownerId = current.ownerId || req.user.id;
    payload.sessionType = current.sessionType || "personal";
    payload.startedBy = current.startedBy || current.ownerId || req.user.id;
    payload.supervisedBy = current.supervisedBy || null;
    const normalizedDate = toLocalISODate(payload.date);
    payload.date = normalizedDate || payload.date;
    payload.progressScopeId = await resolveTrainingProgressScope(
      req,
      payload,
      current,
    );
    payload.exercises = normalizeExerciseOrders(
      await enrichTrainingExercises(payload.exercises),
    );
    payload.orderSignature =
      String(payload.orderSignature || "").trim() ||
      buildOrderSignature(payload.exercises);
    payload.timeEvents = normalizeTimeEvents(payload.timeEvents);
    const timingSummary = calculateTimingSummary(payload.timeEvents);
    if (current.durationOverrideSeconds != null) {
      payload.durationOverrideSeconds = current.durationOverrideSeconds;
      payload.durationSeconds = current.durationOverrideSeconds;
    } else if (timingSummary.durationSeconds > 0) {
      payload.durationSeconds = timingSummary.durationSeconds;
      payload.exerciseDurations = timingSummary.exerciseDurations;
    }
    payload.workSeconds = timingSummary.workSeconds;
    payload.restSeconds = timingSummary.restSeconds;
    payload.pauseSeconds = timingSummary.pauseSeconds;
    const loadMetrics = getTrainingLoadMetrics(payload.exercises);
    payload.totalVolume = loadMetrics.recordedKg;
    payload.volumeBreakdown = loadMetrics;
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
    if (!(await canMutateTraining(req, current))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await Training.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
