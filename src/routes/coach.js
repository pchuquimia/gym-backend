import crypto from "crypto";
import { Router } from "express";
import {
  authorizeRoles,
  protect,
  requireFeature,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import PlanTemplate from "../models/PlanTemplate.js";
import Training from "../models/Training.js";
import User from "../models/User.js";
import AthleteCheckIn from "../models/AthleteCheckIn.js";
import {
  isFuturePlan,
  syncTrainingPlanLifecycle,
} from "../utils/trainingPlanLifecycle.js";
import { transitionAthleteCoach } from "../utils/coachAssignment.js";
import {
  buildAssistedPlanDraft,
  buildWeeklyReport,
  dateKey,
  shiftDateKey,
} from "../utils/coachPremium.js";
import { PREMIUM_FEATURES } from "../utils/subscription.js";

const router = Router();
const PLAN_LEVELS = ["beginner", "intermediate", "advanced"];

router.use(protect);

const canonicalCoachCode = (value) => {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith("APEX") || compact.length !== 12) return "";
  return `APEX-${compact.slice(4)}`;
};

const createCoachCode = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `APEX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await User.exists({ coachCode: code }))) return code;
  }
  throw new Error("No se pudo generar un código de coach");
};

const ensureCoachCode = async (userId) => {
  const current = await User.findById(userId, "coachCode").lean();
  if (current?.coachCode) return current.coachCode;
  const code = await createCoachCode();
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { coachCode: code } },
    { new: true },
  ).select("coachCode");
  return updated.coachCode;
};

router.get(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const athlete = await User.findById(
        req.user.id,
        "assignedTrainerId trainingMode",
      ).lean();
      const coach = athlete?.assignedTrainerId
        ? await User.findOne(
            {
              _id: athlete.assignedTrainerId,
              role: { $in: ["Admin", "Entrenador"] },
              isActive: true,
            },
            "name email role profile.avatarPhotoId",
          ).lean()
        : null;
      res.set("Cache-Control", "private, no-store");
      res.json({
        connected: Boolean(coach),
        coach,
        trainingMode: coach ? "coach_managed" : "independent",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const coachCode = canonicalCoachCode(req.body.coachCode);
      if (!coachCode) {
        return res.status(400).json({ error: "Código de coach inválido" });
      }
      const coach = await User.findOne(
        {
          coachCode,
          role: { $in: ["Admin", "Entrenador"] },
          isActive: true,
        },
        "name email role profile.avatarPhotoId",
      ).lean();
      if (!coach) {
        return res.status(404).json({ error: "No encontramos ese coach" });
      }
      const athlete = await User.findById(
        req.user.id,
        "assignedTrainerId trainingMode",
      );
      if (!athlete)
        return res.status(404).json({ error: "Usuario no encontrado" });
      const previousCoachId = String(athlete.assignedTrainerId || "");
      const nextCoachId = String(coach._id);
      if (
        previousCoachId &&
        previousCoachId !== nextCoachId &&
        req.body.confirmTransfer !== true
      ) {
        return res.status(409).json({
          error: "Confirma el cambio de coach",
          code: "COACH_TRANSFER_CONFIRMATION_REQUIRED",
        });
      }
      await transitionAthleteCoach({
        athleteId: athlete._id,
        previousCoachId,
        nextCoachId,
      });
      athlete.assignedTrainerId = nextCoachId;
      athlete.trainingMode = "coach_managed";
      await athlete.save();
      res.json({ connected: true, coach, trainingMode: "coach_managed" });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const athlete = await User.findById(
        req.user.id,
        "assignedTrainerId trainingMode",
      );
      if (!athlete)
        return res.status(404).json({ error: "Usuario no encontrado" });
      await transitionAthleteCoach({
        athleteId: athlete._id,
        previousCoachId: athlete.assignedTrainerId,
        nextCoachId: null,
      });
      athlete.assignedTrainerId = null;
      athlete.trainingMode = "independent";
      await athlete.save();
      res.json({ connected: false, coach: null, trainingMode: "independent" });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/link-code",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const coachCode = await ensureCoachCode(req.user.id);
      const athleteCount = await User.countDocuments({
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      });
      res.set("Cache-Control", "private, no-store");
      res.json({ coachCode, athleteCount });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/link-code/regenerate",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const coachCode = await createCoachCode();
      await User.findByIdAndUpdate(req.user.id, { $set: { coachCode } });
      res.json({ coachCode });
    } catch (err) {
      next(err);
    }
  },
);

router.use(authorizeRoles("Admin", "Entrenador"));

const athleteFilter = (coachId, athleteId) => ({
  _id: athleteId,
  role: "Cliente",
  assignedTrainerId: coachId,
  isActive: true,
});

const getAthlete = async (coachId, athleteId) =>
  User.findOne(
    athleteFilter(coachId, athleteId),
    "name email role profile.goal profile.weight profile.height profile.avatarPhotoId",
  ).lean();

const requestToday = (value) => {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return dateKey();
  return dateKey(`${candidate}T12:00:00.000Z`) === candidate
    ? candidate
    : dateKey();
};

router.get(
  "/portfolio",
  requireFeature(PREMIUM_FEATURES.COACH_PORTFOLIO),
  async (req, res, next) => {
    try {
      const athletes = await User.find(
        {
          role: "Cliente",
          assignedTrainerId: req.user.id,
          isActive: true,
        },
        "name email profile.goal profile.weight profile.height profile.avatarPhotoId updatedAt",
      )
        .sort({ name: 1 })
        .lean();
      const athleteIds = athletes.map((athlete) => String(athlete._id));
      if (!athleteIds.length) {
        return res.json({
          generatedAt: new Date().toISOString(),
          summary: {
            athletes: 0,
            attention: 0,
            onTrack: 0,
            sessionsThisWeek: 0,
            adherence: 0,
          },
          alerts: [],
          athletes: [],
        });
      }

      const todayKey = requestToday(req.query.today);
      const historyFrom = shiftDateKey(todayKey, -34);
      const [trainings, plans, checkIns, routineCounts] = await Promise.all([
        Training.find({
          ownerId: { $in: athleteIds },
          date: { $gte: historyFrom },
        })
          .select(
            "ownerId date durationSeconds totalVolume volumeBreakdown exercises",
          )
          .lean(),
        TrainingPlan.find({
          athleteId: { $in: athleteIds },
          coachId: req.user.id,
          status: { $in: ["active", "scheduled"] },
        })
          .sort({ status: 1, updatedAt: -1 })
          .lean(),
        AthleteCheckIn.find({ athleteId: { $in: athleteIds } })
          .sort({ dateKey: -1, updatedAt: -1 })
          .lean(),
        Routine.aggregate([
          {
            $match: { ownerId: { $in: athleteIds }, isArchived: { $ne: true } },
          },
          { $group: { _id: "$ownerId", count: { $sum: 1 } } },
        ]),
      ]);

      const trainingsByAthlete = new Map();
      trainings.forEach((training) => {
        const key = String(training.ownerId);
        trainingsByAthlete.set(key, [
          ...(trainingsByAthlete.get(key) || []),
          training,
        ]);
      });
      const planByAthlete = new Map();
      plans.forEach((plan) => {
        const key = String(plan.athleteId);
        const current = planByAthlete.get(key);
        if (!current || plan.status === "active") planByAthlete.set(key, plan);
      });
      const checkInByAthlete = new Map();
      checkIns.forEach((checkIn) => {
        const key = String(checkIn.athleteId);
        if (!checkInByAthlete.has(key)) checkInByAthlete.set(key, checkIn);
      });
      const routineCountByAthlete = new Map(
        routineCounts.map((item) => [String(item._id), item.count]),
      );

      const enriched = athletes.map((athlete) => {
        const id = String(athlete._id);
        const athleteTrainings = trainingsByAthlete.get(id) || [];
        const report = buildWeeklyReport({
          athlete,
          trainings: athleteTrainings,
          activePlan: planByAthlete.get(id) || null,
          latestCheckIn: checkInByAthlete.get(id) || null,
          today: new Date(`${todayKey}T12:00:00.000Z`),
        });
        const sortedTrainings = [...athleteTrainings].sort((a, b) =>
          b.date.localeCompare(a.date),
        );
        return {
          ...athlete,
          id,
          routineCount: routineCountByAthlete.get(id) || 0,
          trainingCount: athleteTrainings.length,
          lastTraining: sortedTrainings[0] || null,
          weekly: report.current,
          adherence: report.adherence,
          priority: report.priority,
          alerts: report.alerts,
          readiness: report.readiness,
        };
      });
      const allAlerts = enriched
        .flatMap((athlete) =>
          athlete.alerts.map((alert) => ({
            ...alert,
            athleteId: athlete.id,
            athleteName: athlete.name,
          })),
        )
        .sort((left, right) => (left.severity === "high" ? -1 : 1));
      const totalTarget = enriched.reduce(
        (sum, athlete) => sum + athlete.adherence.target,
        0,
      );
      const totalCompleted = enriched.reduce(
        (sum, athlete) => sum + athlete.adherence.completed,
        0,
      );
      res.set("Cache-Control", "private, no-store");
      res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          athletes: enriched.length,
          attention: enriched.filter((athlete) => athlete.priority === "high")
            .length,
          onTrack: enriched.filter((athlete) => athlete.priority === "normal")
            .length,
          sessionsThisWeek: totalCompleted,
          adherence: totalTarget
            ? Math.round(Math.min(1, totalCompleted / totalTarget) * 100)
            : 0,
        },
        alerts: allAlerts.slice(0, 20),
        athletes: enriched,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/athletes/:athleteId/weekly-report",
  requireFeature(PREMIUM_FEATURES.WEEKLY_REPORTS),
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete)
        return res.status(404).json({ error: "Atleta no encontrado" });
      const athleteId = String(athlete._id);
      const todayKey = requestToday(req.query.today);
      const from = shiftDateKey(todayKey, -34);
      const [trainings, activePlan, latestCheckIn] = await Promise.all([
        Training.find({ ownerId: athleteId, date: { $gte: from } })
          .sort({ date: -1 })
          .select(
            "date durationSeconds totalVolume volumeBreakdown exercises routineName",
          )
          .lean(),
        TrainingPlan.findOne({
          athleteId,
          coachId: req.user.id,
          status: "active",
        })
          .sort({ updatedAt: -1 })
          .lean(),
        AthleteCheckIn.findOne({ athleteId }).sort({ dateKey: -1 }).lean(),
      ]);
      res.set("Cache-Control", "private, no-store");
      res.json(
        buildWeeklyReport({
          athlete,
          trainings,
          activePlan,
          latestCheckIn,
          today: new Date(`${todayKey}T12:00:00.000Z`),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/athletes/:athleteId/plan-draft",
  requireFeature(PREMIUM_FEATURES.ASSISTED_PLANS),
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete)
        return res.status(404).json({ error: "Atleta no encontrado" });
      const athleteId = String(athlete._id);
      const [routines, trainings, latestCheckIn] = await Promise.all([
        Routine.find({ ownerId: req.user.id, isArchived: { $ne: true } })
          .sort({ updatedAt: -1 })
          .select("name goal level exercises isArchived updatedAt")
          .limit(12)
          .lean(),
        Training.find({ ownerId: athleteId })
          .sort({ date: -1 })
          .select("date routineId routineName totalVolume durationSeconds")
          .limit(100)
          .lean(),
        AthleteCheckIn.findOne({ athleteId }).sort({ dateKey: -1 }).lean(),
      ]);
      const requestedFrequency = Number(req.body.frequency);
      const draft = buildAssistedPlanDraft({
        athlete,
        routines,
        trainings,
        latestCheckIn,
        frequency: Number.isInteger(requestedFrequency)
          ? requestedFrequency
          : undefined,
        today: new Date(`${requestToday(req.body.today)}T12:00:00.000Z`),
      });
      res.json(draft);
    } catch (error) {
      next(error);
    }
  },
);

const normalizeSchedule = (value, scheduleMode = "fixed") => {
  const sequential = scheduleMode !== "fixed";
  if (
    !Array.isArray(value) ||
    (sequential ? value.length < 2 || value.length > 28 : value.length !== 7)
  )
    return null;
  let trainingOrder = 0;
  const days = value.map((day, index) => {
    const type = ["training", "rest", "recovery"].includes(day.type)
      ? day.type
      : "training";
    if (type === "training") trainingOrder += 1;
    return {
      slotId: String(day.slotId || `slot_${Number(day.dayIndex) || index + 1}`),
      order: type === "training" ? trainingOrder : index + 1,
      dayIndex: Number(day.dayIndex),
      type,
      focus: String(day.focus || "").trim(),
      sourceRoutineId:
        type === "training" && day.sourceRoutineId
          ? String(day.sourceRoutineId).trim()
          : null,
      routineId:
        type === "training" && day.routineId
          ? String(day.routineId).trim()
          : null,
    };
  });
  const indexes = new Set(days.map((day) => day.dayIndex));
  if (
    indexes.size !== days.length ||
    [...indexes].some((index) => index < 1 || index > days.length)
  ) {
    return null;
  }
  return days.sort((a, b) => a.dayIndex - b.dayIndex);
};

const normalizePlanName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");

const sameDraftStructure = (plan, candidate) => {
  const planDays = plan.weeklySchedule || [];
  const candidateDays = candidate.weeklySchedule || [];
  return (
    normalizePlanName(plan.name) === normalizePlanName(candidate.name) &&
    String(plan.scheduleMode || "fixed") ===
      String(candidate.scheduleMode || "fixed") &&
    Number(plan.durationWeeks) === Number(candidate.durationWeeks) &&
    new Date(plan.startDate).toISOString().slice(0, 10) ===
      new Date(candidate.startDate).toISOString().slice(0, 10) &&
    planDays.length === candidateDays.length &&
    planDays.every((day, index) => {
      const other = candidateDays[index];
      return (
        Number(day.dayIndex) === Number(other?.dayIndex) &&
        day.type === other?.type &&
        String(day.focus || "").trim() === String(other?.focus || "").trim() &&
        String(day.sourceRoutineId || "") ===
          String(other?.sourceRoutineId || "")
      );
    })
  );
};

const findCoachSourceRoutines = ({ coachId, sourceIds, sourcePlanId }) => {
  if (!sourceIds.length) return [];
  const availability = [{ isArchived: { $ne: true } }];
  if (sourcePlanId) {
    availability.push({ trainingPlanId: String(sourcePlanId) });
  }
  return Routine.find({
    _id: { $in: sourceIds },
    ownerId: String(coachId),
    $or: availability,
  }).lean();
};

router.get("/plan-catalog", async (req, res, next) => {
  try {
    const plans = await TrainingPlan.find({
      athleteId: req.user.id,
      coachId: null,
      status: { $ne: "cancelled" },
      $or: [
        { createdById: req.user.id },
        { createdById: null },
        { createdById: { $exists: false } },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();
    const routineIds = [
      ...new Set(
        plans.flatMap((plan) =>
          (plan.weeklySchedule || [])
            .filter((day) => day.type === "training")
            .map((day) => String(day.routineId || day.sourceRoutineId || ""))
            .filter(Boolean),
        ),
      ),
    ];
    const routines = routineIds.length
      ? await Routine.find({
          _id: { $in: routineIds },
          ownerId: req.user.id,
        }).lean()
      : [];
    const availableRoutineIds = new Set(
      routines.map((routine) => String(routine._id)),
    );
    const catalogPlans = plans.map((plan) => ({
      ...plan,
      sourcePlanId: String(plan._id),
      catalogSource: "training_plan",
      weeklySchedule: (plan.weeklySchedule || []).map((day) => {
        const routineId = String(day.routineId || day.sourceRoutineId || "");
        return {
          ...day,
          sourceRoutineId:
            day.type === "training" && availableRoutineIds.has(routineId)
              ? routineId
              : null,
        };
      }),
    }));

    res.set("Cache-Control", "private, no-store");
    res.json({ plans: catalogPlans, routines });
  } catch (err) {
    next(err);
  }
});

router.get("/athletes", async (req, res, next) => {
  try {
    const athletes = await User.find(
      {
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      },
      "name email profile.goal profile.weight profile.height profile.avatarPhotoId updatedAt",
    )
      .sort({ name: 1 })
      .lean();

    const enriched = await Promise.all(
      athletes.map(async (athlete) => {
        const athleteId = athlete._id.toString();
        const [routineCount, trainingCount, lastTraining] = await Promise.all([
          Routine.countDocuments({
            ownerId: athleteId,
            isArchived: { $ne: true },
          }),
          Training.countDocuments({ ownerId: athleteId }),
          Training.findOne({ ownerId: athleteId }, "date routineName")
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        ]);
        return {
          ...athlete,
          id: athleteId,
          routineCount,
          trainingCount,
          lastTraining: lastTraining || null,
        };
      }),
    );

    res.set("Cache-Control", "private, no-store");
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.delete("/athletes/:athleteId/relationship", async (req, res, next) => {
  try {
    const athlete = await User.findOne(
      athleteFilter(req.user.id, req.params.athleteId),
      "assignedTrainerId trainingMode name",
    );
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    await transitionAthleteCoach({
      athleteId: athlete._id,
      previousCoachId: req.user.id,
      nextCoachId: null,
    });
    athlete.assignedTrainerId = null;
    athlete.trainingMode = "independent";
    await athlete.save();
    res.json({ ok: true, athleteId: String(athlete._id) });
  } catch (err) {
    next(err);
  }
});

router.get("/athletes/:athleteId/overview", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const ownerId = athlete._id.toString();
    await syncTrainingPlanLifecycle(ownerId);
    const plans = await TrainingPlan.find({
      athleteId: ownerId,
      coachId: req.user.id,
      status: { $ne: "cancelled" },
    })
      .sort({ updatedAt: -1 })
      .limit(12)
      .lean();
    const editablePlanIds = plans
      .filter((plan) =>
        ["draft", "scheduled", "active", "paused"].includes(plan.status),
      )
      .map((plan) => String(plan._id));
    const [routines, recentTrainings] = await Promise.all([
      Routine.find({
        ownerId,
        $or: [
          { isArchived: { $ne: true } },
          { trainingPlanId: { $in: editablePlanIds } },
        ],
      })
        .sort({ updatedAt: -1 })
        .select(
          "name branch exercises assignedByCoachId assignedAt trainingPlanId assignmentType isArchived isAvailableForTraining updatedAt",
        )
        .lean(),
      Training.find({ ownerId })
        .sort({ date: -1, createdAt: -1 })
        .limit(12)
        .select(
          "date routineId routineName durationSeconds totalVolume sessionType supervisedBy exercises",
        )
        .lean(),
    ]);

    const totalVolume = recentTrainings.reduce(
      (sum, training) => sum + (Number(training.totalVolume) || 0),
      0,
    );
    res.set("Cache-Control", "private, no-store");
    res.json({
      athlete: { ...athlete, id: ownerId },
      routines,
      recentTrainings,
      plans,
      metrics: {
        routines: routines.length,
        sessions: recentTrainings.length,
        recentVolume: totalVolume,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/athletes/:athleteId/plans", async (req, res, next) => {
  const createdRoutineIds = [];
  let createdPlanId = null;
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }

    const scheduleMode = [
      "fixed",
      "flexible_guided",
      "sequential_cycle",
    ].includes(req.body.scheduleMode)
      ? req.body.scheduleMode
      : "fixed";
    const schedule = normalizeSchedule(req.body.weeklySchedule, scheduleMode);
    if (!schedule) {
      return res
        .status(400)
        .json({ error: "Configura una semana o ciclo valido" });
    }
    if (!schedule.some((day) => day.type === "training")) {
      return res
        .status(400)
        .json({ error: "El plan necesita al menos un dia de entrenamiento" });
    }
    const durationWeeks = Number(req.body.durationWeeks) || 8;
    if (
      !Number.isInteger(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      return res
        .status(400)
        .json({ error: "La duracion debe ser de 1 a 52 semanas" });
    }
    const planName = String(req.body.name || "").trim();
    if (!planName || planName.length > 100) {
      return res.status(400).json({ error: "Ingresa un nombre para el plan" });
    }
    const level = PLAN_LEVELS.includes(req.body.level)
      ? req.body.level
      : "beginner";
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Selecciona una fecha de inicio" });
    }
    const nextStatus = "draft";

    const existingDrafts = await TrainingPlan.find({
      athleteId: athlete._id.toString(),
      coachId: req.user.id,
      status: "draft",
    }).lean();
    const duplicateDraft = existingDrafts.find((draft) =>
      sameDraftStructure(draft, {
        name: planName,
        scheduleMode,
        durationWeeks,
        startDate,
        weeklySchedule: schedule,
      }),
    );
    if (duplicateDraft) {
      return res.status(409).json({
        error: "Ya existe una planificación inactiva idéntica para este atleta",
        planId: duplicateDraft._id,
      });
    }

    if (req.body.planTemplateId && req.body.sourcePlanId) {
      return res.status(400).json({
        error: "Selecciona una sola fuente para la planificacion",
      });
    }
    const sourcePlan = req.body.sourcePlanId
      ? await TrainingPlan.findOne({
          _id: String(req.body.sourcePlanId),
          athleteId: req.user.id,
          coachId: null,
          status: { $ne: "cancelled" },
          $or: [
            { createdById: req.user.id },
            { createdById: null },
            { createdById: { $exists: false } },
          ],
        }).lean()
      : null;
    if (req.body.sourcePlanId && !sourcePlan) {
      return res
        .status(400)
        .json({ error: "Planificacion del catalogo no disponible" });
    }
    const planTemplate = req.body.planTemplateId
      ? await PlanTemplate.findOne({
          _id: String(req.body.planTemplateId),
          isArchived: { $ne: true },
          ownerId: req.user.id,
        }).lean()
      : null;
    if (req.body.planTemplateId && !planTemplate) {
      return res.status(400).json({ error: "Plantilla no disponible" });
    }

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = await findCoachSourceRoutines({
      coachId: req.user.id,
      sourceIds,
      sourcePlanId: sourcePlan?._id,
    });
    if (sources.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "Una de las plantillas no esta disponible" });
    }

    const plan = new TrainingPlan({
      name: planName,
      coachId: req.user.id,
      createdById: req.user.id,
      athleteId: athlete._id.toString(),
      level,
      goal: req.body.goal,
      durationWeeks,
      startDate,
      scheduleMode,
      status: nextStatus,
      planTemplateId: planTemplate?._id || null,
      planTemplateVersion: planTemplate?.version || null,
      planTemplateSnapshot: planTemplate
        ? { name: planTemplate.name, version: planTemplate.version }
        : undefined,
      sourcePlanId: sourcePlan?._id || null,
      sourcePlanSnapshot: sourcePlan
        ? { name: sourcePlan.name, updatedAt: sourcePlan.updatedAt }
        : undefined,
      notes: req.body.notes,
      weeklySchedule: [],
    });
    createdPlanId = plan._id;

    const assignedRoutineBySource = new Map();
    for (const source of sources) {
      const routineId = `routine_${crypto.randomUUID()}`;
      const assignedRoutine = await Routine.create({
        _id: routineId,
        name: source.name,
        description: source.description || "",
        templateGroup: source.templateGroup || "",
        goal: source.goal || "",
        level: source.level || "",
        tags: source.tags || [],
        exerciseOrderMode: source.exerciseOrderMode || "free",
        branch: req.body.branch || "general",
        exercises: source.exercises || [],
        ownerId: athlete._id.toString(),
        progressMode: "fresh",
        progressScopeId: `scope_${crypto.randomUUID()}`,
        sourceRoutineId: source._id,
        sourceRoutineVersion: Number(source.version || 1),
        kind: "assigned",
        version: 1,
        assignedByCoachId: req.user.id,
        assignedAt: new Date(),
        trainingPlanId: String(plan._id),
        assignmentType: "plan",
        isArchived: true,
        isAvailableForTraining: false,
      });
      createdRoutineIds.push(routineId);
      assignedRoutineBySource.set(String(source._id), assignedRoutine._id);
    }

    plan.weeklySchedule = schedule.map((day) => ({
      ...day,
      sourceRoutineId: day.type === "training" ? day.sourceRoutineId : null,
      routineId:
        day.type === "training" && day.sourceRoutineId
          ? assignedRoutineBySource.get(day.sourceRoutineId)
          : null,
    }));
    await plan.save();

    res.status(201).json(plan);
  } catch (err) {
    if (createdPlanId) {
      await TrainingPlan.findByIdAndDelete(createdPlanId).catch(() => {});
    }
    if (createdRoutineIds.length) {
      await Routine.deleteMany({ _id: { $in: createdRoutineIds } }).catch(
        () => {},
      );
    }
    next(err);
  }
});

router.patch(
  "/athletes/:athleteId/plans/:planId/status",
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete) {
        return res.status(404).json({ error: "Atleta no encontrado" });
      }
      const requestedStatus = String(req.body.status || "");
      if (!["active", "paused", "completed"].includes(requestedStatus)) {
        return res.status(400).json({ error: "Estado de plan no valido" });
      }
      const plan = await TrainingPlan.findOne({
        _id: req.params.planId,
        athleteId: athlete._id.toString(),
        coachId: req.user.id,
      });
      if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
      if (["completed", "cancelled"].includes(plan.status)) {
        return res
          .status(409)
          .json({ error: "Un plan finalizado no puede cambiar de estado" });
      }

      const allowedTransitions = {
        draft: ["active", "paused"],
        scheduled: ["active", "paused", "completed"],
        active: ["paused", "completed"],
        paused: ["active", "completed"],
      };
      if (!allowedTransitions[plan.status]?.includes(requestedStatus)) {
        return res.status(409).json({ error: "Cambio de estado no permitido" });
      }
      const status =
        requestedStatus === "active" && isFuturePlan(plan)
          ? "scheduled"
          : requestedStatus;

      if (["active", "scheduled"].includes(status)) {
        const incompleteDays = (plan.weeklySchedule || []).filter(
          (day) => day.type === "training" && !day.routineId,
        );
        if (incompleteDays.length) {
          return res.status(409).json({
            error: `Completa las rutinas de ${incompleteDays.length} ${incompleteDays.length === 1 ? "dia" : "dias"} antes de activar el plan`,
          });
        }
        const routineIds = (plan.weeklySchedule || [])
          .filter((day) => day.type === "training")
          .map((day) => day.routineId);
        const routineCount = await Routine.countDocuments({
          _id: { $in: routineIds },
          ownerId: athlete._id.toString(),
          trainingPlanId: String(plan._id),
        });
        if (routineCount !== new Set(routineIds.map(String)).size) {
          return res.status(409).json({
            error: "Una de las rutinas del plan ya no esta disponible",
          });
        }
      }
      if (status === "active") {
        const otherPlans = await TrainingPlan.find(
          {
            _id: { $ne: plan._id },
            athleteId: athlete._id.toString(),
            status: "active",
          },
          "weeklySchedule.routineId",
        ).lean();
        const otherPlanIds = otherPlans.map((item) => String(item._id));
        await TrainingPlan.updateMany(
          { _id: { $in: otherPlanIds } },
          { $set: { status: "paused" } },
        );
        if (otherPlanIds.length) {
          await Routine.updateMany(
            {
              ownerId: athlete._id.toString(),
              trainingPlanId: { $in: otherPlanIds },
            },
            { $set: { isArchived: true, isAvailableForTraining: false } },
          );
        }
      } else if (status === "scheduled") {
        await TrainingPlan.updateMany(
          {
            _id: { $ne: plan._id },
            athleteId: athlete._id.toString(),
            status: "scheduled",
          },
          { $set: { status: "paused" } },
        );
      }

      plan.status = status;
      await plan.save();
      await Routine.updateMany(
        {
          ownerId: athlete._id.toString(),
          trainingPlanId: String(plan._id),
        },
        {
          $set: {
            isArchived: status !== "active",
            isAvailableForTraining: status === "active",
          },
        },
      );
      res.json(plan);
    } catch (err) {
      next(err);
    }
  },
);

router.put("/athletes/:athleteId/plans/:planId", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const plan = await TrainingPlan.findOne({
      _id: req.params.planId,
      athleteId: athlete._id.toString(),
      coachId: req.user.id,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    if (["completed", "cancelled"].includes(plan.status)) {
      return res
        .status(409)
        .json({ error: "Un plan finalizado no puede editarse" });
    }

    const scheduleMode = [
      "fixed",
      "flexible_guided",
      "sequential_cycle",
    ].includes(req.body.scheduleMode)
      ? req.body.scheduleMode
      : plan.scheduleMode || "fixed";
    const schedule = normalizeSchedule(req.body.weeklySchedule, scheduleMode);
    if (!schedule || !schedule.some((day) => day.type === "training")) {
      return res.status(400).json({ error: "Configura una semana valida" });
    }
    const durationWeeks = Number(req.body.durationWeeks);
    if (
      !Number.isInteger(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      return res
        .status(400)
        .json({ error: "La duracion debe ser de 1 a 52 semanas" });
    }
    const name = String(req.body.name || "").trim();
    const goal = String(req.body.goal || "General").trim();
    const notes = String(req.body.notes || "").trim();
    if (!name || name.length > 100 || goal.length > 80 || notes.length > 1000) {
      return res
        .status(400)
        .json({ error: "Revisa los datos generales del plan" });
    }
    const level = PLAN_LEVELS.includes(req.body.level)
      ? req.body.level
      : plan.level;
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Selecciona una fecha de inicio" });
    }
    const hasCompleteRoutines = schedule
      .filter((day) => day.type === "training")
      .every((day) => day.sourceRoutineId);
    const nextStatus = hasCompleteRoutines ? plan.status : "draft";

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = await findCoachSourceRoutines({
      coachId: req.user.id,
      sourceIds,
      sourcePlanId: plan.sourcePlanId,
    });
    if (sources.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "Una de las plantillas no esta disponible" });
    }

    const existingRoutines = await Routine.find({
      ownerId: athlete._id.toString(),
      trainingPlanId: String(plan._id),
    });
    const existingBySource = new Map(
      existingRoutines.map((routine) => [
        String(routine.sourceRoutineId),
        routine,
      ]),
    );
    const routineBySource = new Map();
    const selectedRoutineIds = [];
    for (const source of sources) {
      let assigned = existingBySource.get(String(source._id));
      if (!assigned) {
        assigned = new Routine({
          _id: `routine_${crypto.randomUUID()}`,
          ownerId: athlete._id.toString(),
          progressMode: "fresh",
          progressScopeId: `scope_${crypto.randomUUID()}`,
          sourceRoutineId: source._id,
          sourceRoutineVersion: Number(source.version || 1),
          kind: "assigned",
          version: 1,
          assignedByCoachId: req.user.id,
          assignedAt: new Date(),
          trainingPlanId: String(plan._id),
          assignmentType: "plan",
        });
      }
      assigned.name = source.name;
      assigned.description = source.description || "";
      assigned.templateGroup = source.templateGroup || "";
      assigned.goal = source.goal || "";
      assigned.level = source.level || "";
      assigned.tags = source.tags || [];
      assigned.exerciseOrderMode = source.exerciseOrderMode || "free";
      assigned.branch = req.body.branch || assigned.branch || "general";
      assigned.exercises = source.exercises || [];
      assigned.sourceRoutineVersion = Number(source.version || 1);
      assigned.isArchived = nextStatus !== "active";
      assigned.isAvailableForTraining = nextStatus === "active";
      await assigned.save();
      selectedRoutineIds.push(String(assigned._id));
      routineBySource.set(String(source._id), assigned._id);
    }
    await Routine.updateMany(
      {
        ownerId: athlete._id.toString(),
        trainingPlanId: String(plan._id),
        _id: { $nin: selectedRoutineIds },
      },
      { $set: { isArchived: true, isAvailableForTraining: false } },
    );

    plan.name = name;
    plan.level = level;
    plan.goal = goal;
    plan.durationWeeks = durationWeeks;
    plan.startDate = startDate;
    plan.scheduleMode = scheduleMode;
    plan.status = nextStatus;
    plan.notes = notes;
    plan.weeklySchedule = schedule.map((day) => ({
      ...day,
      sourceRoutineId: day.type === "training" ? day.sourceRoutineId : null,
      routineId:
        day.type === "training"
          ? routineBySource.get(day.sourceRoutineId)
          : null,
    }));
    await plan.save();

    if (nextStatus === "active") {
      const otherPlans = await TrainingPlan.find(
        {
          _id: { $ne: plan._id },
          athleteId: athlete._id.toString(),
          status: "active",
        },
        "weeklySchedule.routineId",
      ).lean();
      const otherPlanIds = otherPlans.map((item) => String(item._id));
      await TrainingPlan.updateMany(
        { _id: { $in: otherPlanIds } },
        { $set: { status: "paused" } },
      );
      if (otherPlanIds.length) {
        await Routine.updateMany(
          {
            ownerId: athlete._id.toString(),
            trainingPlanId: { $in: otherPlanIds },
          },
          { $set: { isArchived: true, isAvailableForTraining: false } },
        );
      }
    } else if (nextStatus === "scheduled") {
      await TrainingPlan.updateMany(
        {
          _id: { $ne: plan._id },
          athleteId: athlete._id.toString(),
          status: "scheduled",
        },
        { $set: { status: "paused" } },
      );
    }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete("/athletes/:athleteId/plans/:planId", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const ownerId = athlete._id.toString();
    const plan = await TrainingPlan.findOne({
      _id: req.params.planId,
      athleteId: ownerId,
      coachId: req.user.id,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    if (plan.status === "active") {
      return res.status(409).json({
        error: "Pausa el plan activo antes de archivarlo",
      });
    }
    if (["completed", "cancelled"].includes(plan.status)) {
      return res.status(409).json({
        error: "El historial de un plan finalizado no se puede eliminar",
      });
    }

    const hasTrainings = await Training.exists({
      ownerId,
      trainingPlanId: String(plan._id),
    });
    if (plan.status === "draft" && !hasTrainings) {
      const routines = await Routine.deleteMany({
        ownerId,
        trainingPlanId: String(plan._id),
      });
      await plan.deleteOne();
      return res.json({
        ok: true,
        disposition: "deleted",
        deletedRoutines: routines.deletedCount,
      });
    }

    plan.status = "cancelled";
    await Promise.all([
      plan.save(),
      Routine.updateMany(
        { ownerId, trainingPlanId: String(plan._id) },
        { $set: { isArchived: true, isAvailableForTraining: false } },
      ),
    ]);
    res.json({ ok: true, disposition: "archived" });
  } catch (err) {
    next(err);
  }
});

router.post("/athletes/:athleteId/routines", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const sourceRoutineId = String(req.body.sourceRoutineId || "").trim();
    if (!sourceRoutineId) {
      return res.status(400).json({ error: "Selecciona una rutina" });
    }
    const source = await Routine.findOne({
      _id: sourceRoutineId,
      $or: [
        { ownerId: req.user.id, kind: "template" },
        { ownerId: req.user.id, kind: { $exists: false } },
      ],
    }).lean();
    if (!source) {
      return res.status(404).json({ error: "Plantilla no encontrada" });
    }
    const alreadyAssigned = await Routine.exists({
      ownerId: athlete._id.toString(),
      sourceRoutineId: source._id,
      isArchived: { $ne: true },
    });
    if (alreadyAssigned) {
      return res.status(409).json({
        error: "Esta plantilla ya esta disponible para el atleta",
      });
    }

    const routine = await Routine.create({
      _id: `routine_${crypto.randomUUID()}`,
      name: String(req.body.name || source.name).trim(),
      description: source.description || "",
      templateGroup: source.templateGroup || "",
      goal: source.goal || "",
      level: source.level || "",
      tags: source.tags || [],
      exerciseOrderMode: source.exerciseOrderMode || "free",
      branch: req.body.branch || "general",
      exercises: source.exercises || [],
      ownerId: athlete._id.toString(),
      progressMode: "fresh",
      progressScopeId: `scope_${crypto.randomUUID()}`,
      sourceRoutineId: source._id,
      sourceRoutineVersion: Number(source.version || 1),
      kind: "assigned",
      version: 1,
      assignedByCoachId: req.user.id,
      assignedAt: new Date(),
      assignmentType: "extra",
      isArchived: false,
    });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/athletes/:athleteId/routines/:routineId/duplicate",
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete) {
        return res.status(404).json({ error: "Atleta no encontrado" });
      }
      const source = await Routine.findOne({
        _id: req.params.routineId,
        ownerId: athlete._id.toString(),
        assignedByCoachId: req.user.id,
        isArchived: { $ne: true },
      }).lean();
      if (!source) {
        return res.status(404).json({ error: "Rutina no encontrada" });
      }
      const progressMode =
        req.body.progressMode === "inherit" ? "inherit" : "fresh";
      const routine = await Routine.create({
        _id: `routine_${crypto.randomUUID()}`,
        name: `${source.name} (Copia)`,
        description: source.description || "",
        templateGroup: source.templateGroup || "",
        goal: source.goal || "",
        level: source.level || "",
        tags: source.tags || [],
        exerciseOrderMode: source.exerciseOrderMode || "free",
        branch: req.body.branch || "general",
        exercises: source.exercises || [],
        ownerId: athlete._id.toString(),
        progressMode,
        progressScopeId:
          progressMode === "inherit" && source.progressScopeId
            ? source.progressScopeId
            : `scope_${crypto.randomUUID()}`,
        sourceRoutineId: source.sourceRoutineId || source._id,
        sourceRoutineVersion: Number(source.sourceRoutineVersion || 1),
        kind: "assigned",
        version: 1,
        assignedByCoachId: req.user.id,
        assignedAt: new Date(),
        assignmentType: "extra",
        trainingPlanId: null,
        isArchived: false,
        isAvailableForTraining: true,
      });
      res.status(201).json(routine);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
