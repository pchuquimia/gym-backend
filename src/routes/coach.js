import crypto from "crypto";
import { Router } from "express";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import PlanTemplate from "../models/PlanTemplate.js";
import Training from "../models/Training.js";
import User from "../models/User.js";
import {
  isFuturePlan,
  syncTrainingPlanLifecycle,
} from "../utils/trainingPlanLifecycle.js";

const router = Router();
const PLAN_LEVELS = ["beginner", "intermediate", "advanced"];

router.use(protect, authorizeRoles("Entrenador"));

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
        error: "Ya existe un borrador identico para este atleta",
        planId: duplicateDraft._id,
      });
    }

    const planTemplate = req.body.planTemplateId
      ? await PlanTemplate.findOne({
          _id: String(req.body.planTemplateId),
          isArchived: { $ne: true },
          $or: [{ visibility: "system" }, { ownerId: req.user.id }],
        }).lean()
      : null;
    if (req.body.planTemplateId && !planTemplate) {
      return res.status(400).json({ error: "Plantilla no disponible" });
    }

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = sourceIds.length
      ? await Routine.find({
          _id: { $in: sourceIds },
          $or: [
            { ownerId: req.user.id, kind: "template" },
            { ownerId: req.user.id, kind: { $exists: false } },
            { visibility: "system", kind: "template" },
          ],
          isArchived: { $ne: true },
        }).lean()
      : [];
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
    const sources = await Routine.find({
      _id: { $in: sourceIds },
      $or: [
        { ownerId: req.user.id, kind: "template" },
        { ownerId: req.user.id, kind: { $exists: false } },
        { visibility: "system", kind: "template" },
      ],
      isArchived: { $ne: true },
    }).lean();
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
        { visibility: "system", kind: "template" },
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
        progressMode: "fresh",
        progressScopeId: `scope_${crypto.randomUUID()}`,
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
