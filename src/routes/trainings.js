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
import Session from "../models/Session.js";
import TrainingPlan from "../models/TrainingPlan.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";
import { buildTrainingHistoryScopeFilter } from "../utils/trainingHistoryFilter.js";
import {
  buildExerciseHistoryMatch,
  matchesExerciseHistoryTarget,
} from "../utils/exerciseHistory.js";
import {
  classifyExerciseLoad,
  getTrainingLoadMetrics,
} from "../utils/trainingLoad.js";
import {
  buildTrainingRegistrationKey,
  normalizeTrainingDateKey,
  validateTrainingSubmission,
} from "../utils/trainingSubmission.js";
import { normalizeHistoricalExerciseConfig } from "../utils/historicalExerciseConfig.js";
import { toTrainingWeightConfig } from "../utils/weightConfig.js";
import { measureDatabase } from "../middleware/performanceTiming.js";
import { enqueueAthleteMetricRefresh } from "../services/metricRefreshQueue.js";
import {
  applyCursorFilter,
  decodeCursor,
  paginatedResult,
} from "../utils/cursorPagination.js";

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
    new Set(
      exercises
        .map((exercise) => String(exercise.exerciseId || ""))
        .filter(Boolean),
    ),
  );
  const catalog = ids.length
    ? await Exercise.find(
        { _id: { $in: ids } },
        "_id primaryMuscleGroup primaryMuscles secondaryMuscles stabilizerMuscles equipment loadType weightConfig movementMode name",
      ).lean()
    : [];
  const byId = new Map(
    catalog.map((exercise) => [String(exercise._id), exercise]),
  );

  return exercises.map((exercise) => {
    const metadata = byId.get(String(exercise.exerciseId || "")) || {};
    const enriched = {
      ...exercise,
      primaryMuscleGroup:
        exercise.primaryMuscleGroup ||
        metadata.primaryMuscleGroup ||
        exercise.muscleGroup ||
        "",
      primaryMuscles: exercise.primaryMuscles?.length
        ? exercise.primaryMuscles
        : metadata.primaryMuscles || [],
      secondaryMuscles: exercise.secondaryMuscles?.length
        ? exercise.secondaryMuscles
        : metadata.secondaryMuscles || [],
      stabilizerMuscles: exercise.stabilizerMuscles?.length
        ? exercise.stabilizerMuscles
        : metadata.stabilizerMuscles || [],
      equipment: exercise.equipment?.length
        ? exercise.equipment
        : metadata.equipment || [],
      loadType: exercise.loadType || metadata.loadType || "",
      ...(exercise.weightBasis
        ? {
            weightBasis: exercise.weightBasis,
            barWeightKg: Math.max(0, Number(exercise.barWeightKg || 0)),
            implementCount: Math.min(
              4,
              Math.max(1, Number(exercise.implementCount || 1)),
            ),
          }
        : toTrainingWeightConfig({
            ...metadata,
            ...exercise,
            weightConfig: metadata.weightConfig,
          })),
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

// GET /api/trainings/exercise-counts?athleteId=
// Conteo ligero para localizar ejercicios con historial sin descargar sus series.
router.get("/exercise-counts", async (req, res, next) => {
  try {
    const ownerFilter = await getAccessibleOwnerFilter(req);
    const [trainingRows, sessionRows] = await Promise.all([
      Training.aggregate([
        { $match: ownerFilter },
        { $unwind: "$exercises" },
        {
          $match: {
            "exercises.exerciseId": { $nin: [null, ""] },
            "exercises.sets.0": { $exists: true },
          },
        },
        {
          $group: {
            _id: "$exercises.exerciseId",
            recordIds: { $addToSet: { $toString: "$_id" } },
            lastDate: { $max: "$date" },
            historicalGroup: {
              $first: {
                $ifNull: [
                  "$exercises.primaryMuscleGroup",
                  "$exercises.muscleGroup",
                ],
              },
            },
          },
        },
      ]).option({ maxTimeMS: 10000 }),
      Session.aggregate([
        {
          $match: {
            ...ownerFilter,
            exerciseId: { $nin: [null, ""] },
            "sets.0": { $exists: true },
          },
        },
        {
          $group: {
            _id: "$exerciseId",
            recordIds: { $addToSet: { $toString: "$_id" } },
            lastDate: { $max: "$date" },
          },
        },
      ]).option({ maxTimeMS: 10000 }),
    ]);

    const exerciseIds = Array.from(
      new Set(
        [...trainingRows, ...sessionRows]
          .map((row) => String(row._id || ""))
          .filter(Boolean),
      ),
    );
    const catalog = exerciseIds.length
      ? await Exercise.find(
          { _id: { $in: exerciseIds } },
          "_id primaryMuscleGroup muscle primaryMuscle",
        ).lean()
      : [];
    const catalogGroups = new Map(
      catalog.map((exercise) => [
        String(exercise._id),
        exercise.primaryMuscleGroup ||
          exercise.muscle ||
          exercise.primaryMuscle ||
          "Sin grupo",
      ]),
    );
    const counts = new Map();
    const getCount = (exerciseId) => {
      if (!counts.has(exerciseId)) {
        counts.set(exerciseId, {
          exerciseId,
          trainingRecordIds: new Set(),
          legacyRecordIds: new Set(),
          lastDate: null,
          historicalGroup: "",
        });
      }
      return counts.get(exerciseId);
    };

    trainingRows.forEach((row) => {
      const exerciseId = String(row._id || "");
      if (!exerciseId) return;
      const count = getCount(exerciseId);
      row.recordIds.forEach((id) => count.trainingRecordIds.add(String(id)));
      count.lastDate =
        !count.lastDate || String(row.lastDate) > String(count.lastDate)
          ? row.lastDate
          : count.lastDate;
      count.historicalGroup = row.historicalGroup || "";
    });
    sessionRows.forEach((row) => {
      const exerciseId = String(row._id || "");
      if (!exerciseId) return;
      const count = getCount(exerciseId);
      row.recordIds.forEach((id) => count.legacyRecordIds.add(String(id)));
      count.lastDate =
        !count.lastDate || String(row.lastDate) > String(count.lastDate)
          ? row.lastDate
          : count.lastDate;
    });

    const groupRecordIds = new Map();
    const allRecordIds = new Set();
    const exercises = Array.from(counts.values())
      .map((count) => {
        const group =
          catalogGroups.get(count.exerciseId) ||
          count.historicalGroup ||
          "Sin grupo";
        if (!groupRecordIds.has(group)) groupRecordIds.set(group, new Set());
        const groupIds = groupRecordIds.get(group);
        count.trainingRecordIds.forEach((id) => {
          const key = `training:${id}`;
          groupIds.add(key);
          allRecordIds.add(key);
        });
        count.legacyRecordIds.forEach((id) => {
          const key = `session:${id}`;
          groupIds.add(key);
          allRecordIds.add(key);
        });
        return {
          exerciseId: count.exerciseId,
          group,
          count: count.trainingRecordIds.size + count.legacyRecordIds.size,
          trainingCount: count.trainingRecordIds.size,
          legacyCount: count.legacyRecordIds.size,
          lastDate: count.lastDate,
        };
      })
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.exerciseId.localeCompare(right.exerciseId),
      );
    const groups = Array.from(groupRecordIds, ([group, recordIds]) => ({
      group,
      count: recordIds.size,
    })).sort(
      (left, right) =>
        right.count - left.count || left.group.localeCompare(right.group, "es"),
    );

    res.set("Cache-Control", "private, no-store");
    res.json({
      totalSessions: allRecordIds.size,
      exercises,
      groups,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trainings/exercise-history?exerciseId=&exerciseName=&athleteId=
router.get("/exercise-history", async (req, res, next) => {
  try {
    const exerciseId = String(req.query.exerciseId || "").trim();
    const exerciseName = String(req.query.exerciseName || "").trim();
    if (!exerciseId && !exerciseName) {
      return res.status(400).json({
        error: "Se requiere exerciseId o exerciseName",
      });
    }

    const exerciseMatch = buildExerciseHistoryMatch({
      exerciseId,
      exerciseName,
    });
    const filter = await getAccessibleOwnerFilter(req, exerciseMatch);
    const trainings = await Training.find(
      filter,
      "date createdAt routineId routineName trainingPlanId trainingPlanSlotId progressScopeId branch exercises.exerciseId exercises.exerciseName exercises.movementMode exercises.weightBasis exercises.barWeightKg exercises.implementCount exercises.equipment exercises.sets.seriesType exercises.sets.weightKg exercises.sets.reps exercises.sets.done exercises.sets.entries.weightKg exercises.sets.entries.reps exercises.sets.entries.done exercises.sets.entries.completedAt",
    )
      .sort({ date: -1, createdAt: -1 })
      .maxTimeMS(10000)
      .lean();

    const items = trainings
      .map((training) => ({
        ...training,
        exercises: (training.exercises || []).filter((exercise) =>
          matchesExerciseHistoryTarget(exercise, {
            exerciseId,
            exerciseName,
          }),
        ),
      }))
      .filter((training) => training.exercises.length > 0);

    res.set("Cache-Control", "private, no-store");
    res.json({ count: items.length, items });
  } catch (error) {
    next(error);
  }
});

// GET /api/trainings/summary?from=&to=&routineId=
router.get("/summary", async (req, res, next) => {
  try {
    const { from, to, routineId } = req.query;
    let filter = await getAccessibleOwnerFilter(req);
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (routineId) filter.routineId = routineId;

    // Obtenemos las últimas 300 sesiones para el rango solicitado (suficiente para dashboard)
    const trainings = await measureDatabase(res, () =>
      Training.find(
        filter,
        "date routineId routineName branch routineBranch durationSeconds totalVolume exercises",
      )
        .sort({ date: -1 })
        .limit(300)
        .lean(),
    );

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
      const pref = await measureDatabase(res, () =>
        Preference.findOne({ userId: req.user.id }).lean(),
      );
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
    const includeTrainingPlanId = req.query.includeTrainingPlanId;
    const excludeProgressScopeId = req.query.excludeProgressScopeId;

    let filter = await getAccessibleOwnerFilter(req);
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (routineId) {
      filter.routineId = routineId;
    }
    Object.assign(
      filter,
      buildTrainingHistoryScopeFilter({
        progressScopeId,
        includeTrainingPlanId,
        excludeProgressScopeId,
      }),
    );
    const cursor = decodeCursor(req.query.cursor);
    filter = applyCursorFilter(filter, cursor);

    const trainingRows = await measureDatabase(res, () =>
      Training.find(filter, fields || undefined)
        .sort({ date: -1, _id: -1 })
        .skip(cursor ? 0 : (page - 1) * limit)
        .limit(limit + 1)
        .maxTimeMS(10000)
        .lean(),
    );
    const paginated = paginatedResult(trainingRows, limit);

    res.set("Cache-Control", "no-store");
    const localizedTrainings = await measureDatabase(res, () =>
      localizeExerciseReferences(paginated.items, getExerciseLanguage(req)),
    );
    const includeMeta = req.query.meta === "true";
    if (includeMeta) {
      res.json({
        page,
        limit,
        count: localizedTrainings.length,
        hasMore: paginated.hasMore,
        nextCursor: paginated.nextCursor,
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
    const normalizedDate = payload.date
      ? normalizeTrainingDateKey(payload.date)
      : normalizeTrainingDateKey(new Date());
    if (!normalizedDate) {
      return res.status(400).json({
        error: "La fecha del entrenamiento no es valida",
        code: "INVALID_TRAINING_DATE",
      });
    }
    payload.date = normalizedDate;
    payload.registrationKey = buildTrainingRegistrationKey({
      ownerId,
      date: payload.date,
      routineId: payload.routineId,
    });
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
    const submission = validateTrainingSubmission({
      date: payload.date,
      exercises: payload.exercises,
    });
    if (!submission.ok) {
      return res.status(submission.status).json({
        error: submission.error,
        code: submission.code,
      });
    }
    const loadMetrics = submission.loadMetrics;
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
      if (createError?.code === 11000 && payload.routineId) {
        const existing = await Training.findOne({
          ownerId,
          date: payload.date,
          routineId: payload.routineId,
        }).lean();
        if (existing) {
          return res.status(409).json({
            error:
              "Ya existe un entrenamiento para esta rutina en la fecha seleccionada",
            code: "DUPLICATE_TRAINING",
            existingTrainingId: String(existing._id),
          });
        }
      }
      throw createError;
    }
    const registrationWarnings = [];
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
        const acceptedOverride = Boolean(
          payload.scheduleOverride?.acknowledged,
        );
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
          const advancedPlan = await TrainingPlan.findOneAndUpdate(
            {
              _id: plan._id,
              athleteId: ownerId,
              status: "active",
              "cycleProgress.currentIndex": currentIndex,
              "cycleProgress.lastTrainingId": {
                $ne: String(training._id),
              },
            },
            {
              $set: {
                "cycleProgress.currentIndex": nextIndex,
                "cycleProgress.lastAdvancedAt": new Date(),
                "cycleProgress.lastTrainingId": String(training._id),
              },
              $inc: {
                "cycleProgress.completedCycles": nextIndex === 0 ? 1 : 0,
              },
            },
            { new: true, runValidators: true },
          );
          if (!advancedPlan) {
            const latestPlan = await TrainingPlan.findById(
              plan._id,
              "cycleProgress",
            ).lean();
            if (
              latestPlan?.cycleProgress?.lastTrainingId !== String(training._id)
            ) {
              const conflict = new Error(
                "El plan cambio mientras se registraba el entrenamiento",
              );
              conflict.code = "PLAN_CYCLE_CONFLICT";
              throw conflict;
            }
          }
        }
      } catch (cycleError) {
        console.error(
          "No se pudo avanzar el ciclo de entrenamiento",
          cycleError,
        );
        registrationWarnings.push({
          code: cycleError?.code || "PLAN_CYCLE_NOT_ADVANCED",
          message:
            "El entrenamiento se guardo, pero no se pudo avanzar el ciclo del plan",
        });
      }
    }
    await enqueueAthleteMetricRefresh(training.ownerId, training.date);
    const responseBody = training.toObject();
    if (registrationWarnings.length) {
      responseBody.registrationWarnings = registrationWarnings;
    }
    res.status(201).json(responseBody);
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
        "ownerId date sessionType supervisedBy",
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
      await enqueueAthleteMetricRefresh(current.ownerId, current.date);
      res.json(training);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/trainings/:id/exercises/:exerciseId/config
// Corrección administrativa de la interpretación de carga de un registro histórico.
router.patch(
  "/:id/exercises/:exerciseId/config",
  authorizeRoles("Admin"),
  async (req, res, next) => {
    try {
      const training = await Training.findById(req.params.id);
      if (!training) return res.status(404).json({ error: "No encontrado" });
      if (!(await ensureCanAccessOwner(req, training.ownerId))) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const exerciseIndex = training.exercises.findIndex(
        (exercise) =>
          String(exercise.exerciseId || "") === String(req.params.exerciseId),
      );
      if (exerciseIndex < 0) {
        return res.status(404).json({
          error: "El ejercicio no pertenece a este entrenamiento",
        });
      }

      const exercise = training.exercises[exerciseIndex];
      const config = normalizeHistoricalExerciseConfig(req.body, exercise);
      Object.assign(exercise, config);
      training.markModified("exercises");

      const loadMetrics = getTrainingLoadMetrics(training.exercises);
      training.totalVolume = loadMetrics.recordedKg;
      training.volumeBreakdown = loadMetrics;
      await training.save();
      await enqueueAthleteMetricRefresh(training.ownerId, training.date);

      res.set("Cache-Control", "private, no-store");
      res.json({
        trainingId: training.id,
        date: training.date,
        routineName: training.routineName,
        exercise,
        totalVolume: training.totalVolume,
        volumeBreakdown: training.volumeBreakdown,
      });
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
    const normalizedDate = normalizeTrainingDateKey(
      payload.date || current.date,
    );
    if (!normalizedDate) {
      return res.status(400).json({
        error: "La fecha del entrenamiento no es valida",
        code: "INVALID_TRAINING_DATE",
      });
    }
    payload.date = normalizedDate;
    payload.registrationKey = buildTrainingRegistrationKey({
      ownerId: current.ownerId,
      date: payload.date,
      routineId: payload.routineId || current.routineId,
    });
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
    const submission = validateTrainingSubmission({
      date: payload.date,
      exercises: payload.exercises,
    });
    if (!submission.ok) {
      return res.status(submission.status).json({
        error: submission.error,
        code: submission.code,
      });
    }
    const loadMetrics = submission.loadMetrics;
    payload.totalVolume = loadMetrics.recordedKg;
    payload.volumeBreakdown = loadMetrics;
    const updated = await Training.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    await Promise.all(
      [...new Set([current.date, updated.date].filter(Boolean))].map((date) =>
        enqueueAthleteMetricRefresh(updated.ownerId, date),
      ),
    );
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
    const dbSession = await Training.startSession();
    let deletedSessions = 0;
    try {
      await dbSession.withTransaction(async () => {
        const sessionResult = await Session.deleteMany(
          { trainingId: String(current._id) },
          { session: dbSession },
        );
        deletedSessions = sessionResult.deletedCount;
        await Training.deleteOne(
          { _id: current._id, ownerId: current.ownerId },
          { session: dbSession },
        );
      });
    } finally {
      await dbSession.endSession();
    }
    await enqueueAthleteMetricRefresh(current.ownerId, current.date);
    res.json({ ok: true, deletedSessions });
  } catch (err) {
    next(err);
  }
});

export default router;
