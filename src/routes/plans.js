import { Router } from "express";
import {
  authorizeRoles,
  ensureCanAccessOwner,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import PlanTemplate from "../models/PlanTemplate.js";
import {
  isFuturePlan,
  syncTrainingPlanLifecycle,
} from "../utils/trainingPlanLifecycle.js";

const router = Router();

router.use(protect);

const getVisibleTemplate = async (req, id) => {
  if (!id) return null;
  return PlanTemplate.findOne({
    _id: String(id),
    isArchived: { $ne: true },
    $or: [{ visibility: "system" }, { ownerId: req.user.id }],
  }).lean();
};

const normalizeSchedule = (value, scheduleMode = "fixed") => {
  const sequential = scheduleMode !== "fixed";
  if (
    !Array.isArray(value) ||
    (sequential ? value.length < 2 || value.length > 28 : value.length !== 7)
  ) {
    return null;
  }
  let trainingOrder = 0;
  const days = value.map((day, index) => {
    const dayIndex = Number(day.dayIndex);
    const type = ["training", "rest", "recovery"].includes(day.type)
      ? day.type
      : "training";
    if (type === "training") trainingOrder += 1;
    return {
      slotId: String(day.slotId || `slot_${dayIndex || index + 1}`),
      order: type === "training" ? trainingOrder : index + 1,
      dayIndex,
      type,
      focus: String(day.focus || "").trim(),
      sourceRoutineId: day.sourceRoutineId || null,
      routineId: day.routineId || null,
    };
  });
  const indexes = new Set(days.map((day) => day.dayIndex));
  return indexes.size === days.length &&
    [...indexes].every((index) => index >= 1 && index <= days.length)
    ? days.sort((a, b) => a.dayIndex - b.dayIndex)
    : null;
};

const readPlanPayload = (body, currentPlan = null) => {
  const scheduleMode = [
    "fixed",
    "flexible_guided",
    "sequential_cycle",
  ].includes(body.scheduleMode)
    ? body.scheduleMode
    : "fixed";
  const weeklySchedule = normalizeSchedule(body.weeklySchedule, scheduleMode);
  const durationWeeks = Number(body.durationWeeks);
  const startDate = body.startDate ? new Date(body.startDate) : null;
  const name = String(body.name || "").trim();
  if (
    !weeklySchedule ||
    !weeklySchedule.some((day) => day.type === "training")
  ) {
    return { error: "Configura una semana con al menos un entrenamiento" };
  }
  if (!name || name.length > 100)
    return { error: "Ingresa un nombre para el plan" };
  if (
    !Number.isInteger(durationWeeks) ||
    durationWeeks < 1 ||
    durationWeeks > 52
  ) {
    return { error: "La duracion debe ser de 1 a 52 semanas" };
  }
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return { error: "Selecciona una fecha de inicio" };
  }
  const previousSlots = new Map(
    (currentPlan?.weeklySchedule || []).map((day) => [day.slotId, day]),
  );
  return {
    value: {
      name,
      level: ["beginner", "intermediate", "advanced"].includes(body.level)
        ? body.level
        : "beginner",
      goal: String(body.goal || "General").trim(),
      durationWeeks,
      startDate,
      scheduleMode,
      notes: String(body.notes || "").trim(),
      weeklySchedule: weeklySchedule.map((day) => {
        const previous = previousSlots.get(day.slotId);
        return {
          ...day,
          routineId:
            day.type === "training" ? previous?.routineId || null : null,
          sourceRoutineId:
            day.type === "training" ? previous?.sourceRoutineId || null : null,
        };
      }),
    },
  };
};

router.get("/", async (req, res, next) => {
  try {
    const athleteId = String(req.query.athleteId || req.user.id).trim();
    if (
      req.user.role !== "Admin" &&
      !(await ensureCanAccessOwner(req, athleteId))
    ) {
      return res
        .status(403)
        .json({ error: "No autorizado para consultar este plan" });
    }
    await syncTrainingPlanLifecycle(athleteId);
    const filter = { athleteId };
    if (req.user.role === "Entrenador") {
      filter.coachId =
        athleteId === String(req.user.id) ? null : String(req.user.id);
    }
    const plans = await TrainingPlan.find(filter)
      .sort({ status: 1, updatedAt: -1 })
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (req.user.role === "Entrenador") {
      return res.status(403).json({
        error:
          "Los coaches crean plantillas y las asignan desde Mis atletas",
      });
    }
    if (
      req.user.role === "Cliente" &&
      req.user.trainingMode === "coach_managed"
    ) {
      return res
        .status(403)
        .json({ error: "Tu coach administra tu planificacion" });
    }
    const parsed = readPlanPayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const template = await getVisibleTemplate(req, req.body.planTemplateId);
    if (req.body.planTemplateId && !template) {
      return res.status(400).json({ error: "Plantilla no disponible" });
    }
    const plan = await TrainingPlan.create({
      ...parsed.value,
      athleteId: req.user.id,
      createdById: req.user.id,
      coachId: null,
      status: "draft",
      planTemplateId: template?._id || null,
      planTemplateVersion: template?.version || null,
      planTemplateSnapshot: template
        ? { name: template.name, version: template.version }
        : undefined,
    });
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/slots/:slotId/routine", async (req, res, next) => {
  try {
    const plan = await TrainingPlan.findOne({
      _id: req.params.id,
      athleteId: req.user.id,
      coachId: null,
      status: { $in: ["draft", "scheduled", "active", "paused"] },
    });
    if (!plan) {
      return res.status(404).json({ error: "Plan editable no encontrado" });
    }
    const slot = plan.weeklySchedule.find(
      (day) => day.slotId === req.params.slotId && day.type === "training",
    );
    if (!slot) {
      return res
        .status(404)
        .json({ error: "Bloque de entrenamiento no encontrado" });
    }
    const routine = await Routine.findOne({
      _id: String(req.body.routineId || ""),
      ownerId: req.user.id,
      $or: [
        { isArchived: { $ne: true } },
        { trainingPlanId: String(plan._id) },
      ],
    }).lean();
    if (!routine) {
      return res.status(404).json({ error: "Rutina no encontrada" });
    }
    slot.routineId = routine._id;
    slot.sourceRoutineId = routine.sourceRoutineId || routine._id;
    await plan.save();
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/cycle/advance", async (req, res, next) => {
  try {
    const plan = await TrainingPlan.findOne({
      _id: req.params.id,
      athleteId: req.user.id,
      status: "active",
      scheduleMode: { $in: ["flexible_guided", "sequential_cycle"] },
    });
    if (!plan)
      return res.status(404).json({ error: "Ciclo activo no encontrado" });
    const schedule = plan.weeklySchedule || [];
    const currentIndex = Number(plan.cycleProgress?.currentIndex || 0);
    const current = schedule[currentIndex];
    if (!current || current.type === "training") {
      return res.status(409).json({
        error: "Completa el entrenamiento actual para avanzar el ciclo",
      });
    }
    const nextIndex = (currentIndex + 1) % schedule.length;
    plan.cycleProgress = plan.cycleProgress || {};
    plan.cycleProgress.currentIndex = nextIndex;
    plan.cycleProgress.completedCycles =
      Number(plan.cycleProgress.completedCycles || 0) +
      (nextIndex === 0 ? 1 : 0);
    plan.cycleProgress.lastAdvancedAt = new Date();
    await plan.save();
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const plan = await TrainingPlan.findOne({
      _id: req.params.id,
      athleteId: req.user.id,
      coachId: null,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    if (["completed", "cancelled"].includes(plan.status)) {
      return res.status(409).json({
        error: "Las planificaciones finalizadas no se pueden editar",
      });
    }
    const parsed = readPlanPayload(req.body, plan);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    Object.assign(plan, parsed.value);
    if (
      plan.status === "active" &&
      plan.weeklySchedule.some(
        (day) => day.type === "training" && !day.routineId,
      )
    ) {
      plan.status = "draft";
    }
    await plan.save();
    if (plan.status === "active" && isFuturePlan(plan)) {
      plan.status = "scheduled";
      await plan.save();
    }
    const selectedRoutineIds = plan.weeklySchedule
      .map((day) => day.routineId)
      .filter(Boolean);
    await Promise.all([
      Routine.updateMany(
        {
          ownerId: req.user.id,
          trainingPlanId: String(plan._id),
          _id: { $in: selectedRoutineIds },
        },
        {
          $set: {
            isArchived: plan.status !== "active",
            isAvailableForTraining: plan.status === "active",
          },
        },
      ),
      Routine.updateMany(
        {
          ownerId: req.user.id,
          trainingPlanId: String(plan._id),
          _id: { $nin: selectedRoutineIds },
        },
        { $set: { isArchived: true, isAvailableForTraining: false } },
      ),
    ]);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!["active", "paused", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Estado de plan no valido" });
    }
    const plan = await TrainingPlan.findOne({
      _id: req.params.id,
      athleteId: req.user.id,
      coachId: null,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    const allowedTransitions = {
      draft: ["active", "cancelled"],
      scheduled: ["active", "paused", "cancelled"],
      active: ["paused", "completed", "cancelled"],
      paused: ["active", "completed", "cancelled"],
      completed: [],
      cancelled: [],
    };
    if (
      status !== plan.status &&
      !allowedTransitions[plan.status]?.includes(status)
    ) {
      return res.status(409).json({
        error: "La planificacion ya no admite ese cambio de estado",
      });
    }
    const nextStatus =
      status === "active" && isFuturePlan(plan) ? "scheduled" : status;
    const routineIds = (plan.weeklySchedule || [])
      .filter((day) => day.type === "training")
      .map((day) => day.routineId);
    if (
      ["active", "scheduled"].includes(nextStatus) &&
      routineIds.some((id) => !id)
    ) {
      return res
        .status(409)
        .json({ error: "Completa todas las rutinas antes de activar el plan" });
    }
    if (["active", "scheduled"].includes(nextStatus)) {
      const validRoutineCount = await Routine.countDocuments({
        _id: { $in: routineIds },
        ownerId: req.user.id,
        $or: [
          { isArchived: { $ne: true } },
          { trainingPlanId: String(plan._id) },
        ],
      });
      if (validRoutineCount !== new Set(routineIds.map(String)).size) {
        return res.status(409).json({
          error: "Una de las rutinas del plan ya no esta disponible",
        });
      }
    }
    if (nextStatus === "active") {
      const previous = await TrainingPlan.find({
        _id: { $ne: plan._id },
        athleteId: req.user.id,
        status: "active",
      }).lean();
      const previousIds = previous.map((item) => String(item._id));
      await TrainingPlan.updateMany(
        { _id: { $in: previousIds } },
        { $set: { status: "paused" } },
      );
      await Routine.updateMany(
        { ownerId: req.user.id, trainingPlanId: { $in: previousIds } },
        { $set: { isArchived: true, isAvailableForTraining: false } },
      );
    }
    if (nextStatus === "scheduled") {
      const otherScheduled = await TrainingPlan.find(
        {
          _id: { $ne: plan._id },
          athleteId: req.user.id,
          status: "scheduled",
        },
        "_id",
      ).lean();
      await TrainingPlan.updateMany(
        { _id: { $in: otherScheduled.map((item) => item._id) } },
        { $set: { status: "paused" } },
      );
    }
    plan.status = nextStatus;
    await plan.save();
    await Routine.updateMany(
      { ownerId: req.user.id, trainingPlanId: String(plan._id) },
      {
        $set: {
          isArchived: ["scheduled", "cancelled", "completed"].includes(
            nextStatus,
          ),
          isAvailableForTraining: nextStatus === "active",
        },
      },
    );
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authorizeRoles("Admin"), async (req, res, next) => {
  try {
    const plan = await TrainingPlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    const [routineResult] = await Promise.all([
      Routine.updateMany(
        {
          ownerId: plan.athleteId,
          trainingPlanId: String(plan._id),
        },
        { $set: { isArchived: true, isAvailableForTraining: false } },
      ),
      TrainingPlan.findByIdAndDelete(plan._id),
    ]);
    res.json({ ok: true, archivedRoutines: routineResult.modifiedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
