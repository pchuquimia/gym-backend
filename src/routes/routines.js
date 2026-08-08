import { Router } from "express";
import crypto from "crypto";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
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

const resolveProgressScope = async (req, payload, ownerId) => {
  if (payload.progressScopeId) return payload.progressScopeId;
  if (payload.progressMode === "inherit" && payload.sourceRoutineId) {
    const source = await Routine.findById(
      payload.sourceRoutineId,
      "ownerId progressScopeId",
    ).lean();
    if (
      source &&
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
    const filter = await getAccessibleOwnerFilter(req, {
      isArchived: { $ne: true },
    });
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
    payload.isArchived = false;
    payload.isAvailableForTraining = true;
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
    if (!(await canManagePlanning(req, current.ownerId))) {
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
    payload.assignedByCoachId = current.assignedByCoachId || null;
    payload.assignedAt = current.assignedAt || null;
    payload.isArchived = current.isArchived === true;
    payload.isAvailableForTraining = current.isAvailableForTraining !== false;
    payload.progressMode =
      payload.progressMode === "inherit" ? "inherit" : "fresh";
    if (!payload.progressScopeId) {
      payload.progressScopeId =
        current.progressScopeId ||
        (await resolveProgressScope(req, payload, payload.ownerId));
    }
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

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Routine.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await canManagePlanning(req, current.ownerId))) {
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
          error: "Esta rutina pertenece al historial de un plan finalizado",
        });
      }
    }
    const affectedPlans = await TrainingPlan.find(
      {
        athleteId: current.ownerId,
        "weeklySchedule.routineId": current._id,
        status: { $in: ["draft", "scheduled", "active", "paused"] },
      },
      "_id",
    ).lean();
    const affectedPlanIds = affectedPlans.map((plan) => String(plan._id));
    await Routine.findByIdAndDelete(req.params.id);
    await TrainingPlan.updateMany(
      { _id: { $in: affectedPlanIds } },
      {
        $set: {
          "weeklySchedule.$[day].routineId": null,
          "weeklySchedule.$[day].sourceRoutineId": null,
          status: "draft",
        },
      },
      {
        arrayFilters: [{ "day.routineId": current._id }],
      },
    );
    if (affectedPlanIds.length) {
      await Routine.updateMany(
        {
          ownerId: current.ownerId,
          trainingPlanId: { $in: affectedPlanIds },
        },
        { $set: { isAvailableForTraining: false } },
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
