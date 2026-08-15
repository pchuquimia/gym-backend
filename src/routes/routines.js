import { Router } from "express";
import crypto from "crypto";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import RoutineAuditLog from "../models/RoutineAuditLog.js";
import TrainingPlan from "../models/TrainingPlan.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";

const router = Router();

router.use(protect);

const createProgressScopeId = () => `scope_${crypto.randomUUID()}`;

const canManagePlanning = async (req, ownerId) => {
  const isManagedSelf =
    req.user.role === "Cliente" &&
    req.user.trainingMode === "coach_managed" &&
    String(ownerId) === req.user.id;
  if (isManagedSelf) return false;
  return ensureCanAccessOwner(req, ownerId);
};

const canManageRoutine = async (req, routine) => {
  if (!(await canManagePlanning(req, routine.ownerId))) return false;
  if (String(routine.ownerId) === String(req.user.id)) return true;
  return (
    ["Admin", "Entrenador"].includes(req.user.role) &&
    String(routine.assignedByCoachId || "") === String(req.user.id)
  );
};

const resolveProgressScope = async (req, payload, ownerId) => {
  if (payload.progressMode === "inherit" && payload.sourceRoutineId) {
    const source = await Routine.findById(
      payload.sourceRoutineId,
      "ownerId progressScopeId",
    ).lean();
    if (
      source &&
      String(source.ownerId || "") === String(ownerId || "") &&
      (await ensureCanAccessOwner(req, source.ownerId || ownerId)) &&
      source.progressScopeId
    ) {
      return source.progressScopeId;
    }
  }
  return createProgressScopeId();
};

router.get("/", async (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const filter = await getAccessibleOwnerFilter(
      req,
      includeArchived ? {} : { isArchived: { $ne: true } },
    );
    if (["template", "personal", "assigned"].includes(req.query.kind)) {
      filter.kind = req.query.kind;
    }
    const routines = await Routine.find(filter).lean();
    res.set("Cache-Control", "private, no-store");
    res.json(
      await localizeExerciseReferences(routines, getExerciseLanguage(req)),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = req.body.ownerId || req.user.id;
    if (!(await canManagePlanning(req, ownerId))) {
      return res.status(403).json({
        error: "Tu coach administra la planificación de tus rutinas",
      });
    }
    const payload = { ...req.body, ownerId };
    if (payload.id && !payload._id) payload._id = payload.id;
    delete payload.id;
    payload.progressMode =
      payload.progressMode === "inherit" ? "inherit" : "fresh";
    payload.progressScopeId = await resolveProgressScope(req, payload, ownerId);
    payload.assignedByCoachId = null;
    payload.assignedAt = null;
    payload.assignmentType = "personal";
    payload.visibility = "private";
    payload.kind =
      req.user.role === "Entrenador" && String(ownerId) === req.user.id
        ? "template"
        : "personal";
    payload.version = 1;
    payload.isArchived = false;
    payload.isAvailableForTraining = true;
    payload.archivedAt = null;
    payload.archivedBy = null;
    payload.archiveReason = null;
    let plan = null;
    let planSlot = null;
    if (payload.trainingPlanId || payload.trainingPlanSlotId) {
      plan = await TrainingPlan.findOne({
        _id: payload.trainingPlanId,
        athleteId: ownerId,
        status: { $in: ["draft", "scheduled", "active", "paused"] },
      });
      if (!plan || !(await ensureCanAccessOwner(req, ownerId))) {
        return res.status(404).json({ error: "Planificacion no encontrada" });
      }
      planSlot = plan.weeklySchedule.find(
        (day) =>
          day.slotId === payload.trainingPlanSlotId && day.type === "training",
      );
      if (!planSlot) {
        return res
          .status(400)
          .json({ error: "El bloque de entrenamiento no es valido" });
      }
      if (planSlot.routineId) {
        return res
          .status(409)
          .json({ error: "Este bloque ya tiene una rutina" });
      }
      payload.assignmentType = "plan";
      payload.kind = "assigned";
      payload.isAvailableForTraining = plan.status === "active";
    }
    const routine = await Routine.create(payload);
    if (plan && planSlot) {
      planSlot.routineId = routine._id;
      planSlot.sourceRoutineId = routine.sourceRoutineId || null;
      await plan.save();
    }
    res
      .status(201)
      .json(
        await localizeExerciseReferences(routine, getExerciseLanguage(req)),
      );
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await Routine.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await canManageRoutine(req, current))) {
      return res.status(403).json({
        error: "Tu coach administra la planificación de tus rutinas",
      });
    }
    if (current.trainingPlanId) {
      const immutablePlan = await TrainingPlan.exists({
        _id: current.trainingPlanId,
        status: { $in: ["completed", "cancelled"] },
      });
      if (immutablePlan) {
        return res.status(409).json({
          error: "Las rutinas de un plan finalizado no se pueden editar",
        });
      }
    }
    const payload = { ...req.body, ownerId: current.ownerId || req.user.id };
    payload.trainingPlanId = current.trainingPlanId || null;
    payload.trainingPlanSlotId = current.trainingPlanSlotId || null;
    payload.assignmentType = current.assignmentType || "personal";
    payload.kind = current.kind || "personal";
    payload.visibility = current.visibility || "private";
    payload.version =
      payload.kind === "template"
        ? Number(current.version || 1) + 1
        : Number(current.version || 1);
    payload.sourceRoutineVersion = current.sourceRoutineVersion || null;
    payload.assignedByCoachId = current.assignedByCoachId || null;
    payload.assignedAt = current.assignedAt || null;
    payload.isArchived = current.isArchived === true;
    payload.isAvailableForTraining = current.isAvailableForTraining !== false;
    payload.archivedAt = current.archivedAt || null;
    payload.archivedBy = current.archivedBy || null;
    payload.archiveReason = current.archiveReason || null;
    payload.progressMode =
      payload.progressMode === "inherit" ? "inherit" : "fresh";
    payload.progressScopeId =
      current.progressScopeId ||
      (await resolveProgressScope(req, payload, payload.ownerId));
    const routine = await Routine.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    res.json(
      await localizeExerciseReferences(routine, getExerciseLanguage(req)),
    );
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/restore", async (req, res, next) => {
  try {
    const current = await Routine.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Rutina no encontrada" });
    if (!(await canManageRoutine(req, current))) {
      return res.status(403).json({
        error: "Tu coach administra la planificaciÃ³n de tus rutinas",
      });
    }
    if (current.isArchived !== true) {
      return res.json(current);
    }
    if (current.archiveReason !== "user") {
      return res.status(409).json({
        error: "Esta rutina se controla desde el estado de su planificacion",
      });
    }
    const routine = await Routine.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          isArchived: false,
          isAvailableForTraining: true,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
        },
      },
      { new: true },
    );
    await RoutineAuditLog.create({
      routineId: String(current._id),
      ownerId: String(current.ownerId),
      actorId: String(req.user.id),
      action: "restored",
      snapshot: { name: current.name },
    });
    res.json(
      await localizeExerciseReferences(routine, getExerciseLanguage(req)),
    );
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Routine.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await canManageRoutine(req, current))) {
      return res.status(403).json({
        error: "Tu coach administra la planificación de tus rutinas",
      });
    }
    if (current.isArchived === true && current.archiveReason === "user") {
      return res.json({
        ok: true,
        archived: true,
        archivedAt: current.archivedAt,
      });
    }
    const affectedPlans = await TrainingPlan.find(
      {
        athleteId: current.ownerId,
        "weeklySchedule.routineId": current._id,
      },
      "_id name status weeklySchedule",
    ).lean();
    if (affectedPlans.length) {
      return res.status(409).json({
        code: "ROUTINE_IN_USE",
        error:
          "La rutina sigue asignada. Reemplazala en la planificacion antes de archivarla.",
        affectedPlans: affectedPlans.map((plan) => ({
          id: String(plan._id),
          name: plan.name,
          status: plan.status,
          slots: (plan.weeklySchedule || [])
            .filter((day) => String(day.routineId || "") === String(current._id))
            .map((day) => ({ slotId: day.slotId, dayIndex: day.dayIndex })),
        })),
      });
    }
    const archivedAt = new Date();
    await Routine.findByIdAndUpdate(req.params.id, {
      $set: {
        isArchived: true,
        isAvailableForTraining: false,
        archivedAt,
        archivedBy: String(req.user.id),
        archiveReason: "user",
      },
    });
    await RoutineAuditLog.create({
      routineId: String(current._id),
      ownerId: String(current.ownerId),
      actorId: String(req.user.id),
      action: "archived",
      snapshot: {
        name: current.name,
        progressScopeId: current.progressScopeId,
        exerciseCount: current.exercises?.length || 0,
      },
    });
    res.json({ ok: true, archived: true, archivedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
