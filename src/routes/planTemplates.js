import crypto from "crypto";
import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import PlanTemplate from "../models/PlanTemplate.js";
import Routine from "../models/Routine.js";
import { ensureDefaultPlanTemplates } from "../utils/defaultPlanTemplates.js";

const router = Router();
router.use(protect);

const normalizeSchedule = (value, mode) => {
  if (!Array.isArray(value)) return null;
  if (mode === "fixed" && value.length !== 7) return null;
  if (mode !== "fixed" && (value.length < 2 || value.length > 28)) return null;
  const days = value.map((day, index) => ({
    slotId: String(day.slotId || `slot_${index + 1}`),
    dayIndex: index + 1,
    type: ["training", "rest", "recovery"].includes(day.type)
      ? day.type
      : "training",
    focus: String(day.focus || "").trim(),
    sourceRoutineId:
      day.type === "training" && day.sourceRoutineId
        ? String(day.sourceRoutineId)
        : null,
  }));
  return days.some((day) => day.type === "training") ? days : null;
};

const readPayload = (body) => {
  const name = String(body.name || "").trim();
  const scheduleMode =
    body.scheduleMode === "sequential_cycle" ? "sequential_cycle" : "fixed";
  const weeklySchedule = normalizeSchedule(body.weeklySchedule, scheduleMode);
  const durationWeeks = Number(body.durationWeeks);
  if (!name || name.length > 100) return { error: "Ingresa un nombre" };
  if (!weeklySchedule) return { error: "Configura al menos un entrenamiento" };
  if (!Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
    return { error: "La duracion debe ser de 1 a 52 semanas" };
  }
  return {
    value: {
      name,
      description: String(body.description || "").trim(),
      level: ["beginner", "intermediate", "advanced"].includes(body.level)
        ? body.level
        : "beginner",
      goal: String(body.goal || "General").trim(),
      durationWeeks,
      scheduleMode,
      weeklySchedule,
      tags: Array.isArray(body.tags)
        ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
        : [],
    },
  };
};

const hasValidRoutineSources = async (schedule, ownerId) => {
  const ids = [
    ...new Set(
      schedule.map((day) => day.sourceRoutineId).filter(Boolean),
    ),
  ];
  if (!ids.length) return true;
  const count = await Routine.countDocuments({
    _id: { $in: ids },
    $or: [
      { ownerId, kind: { $in: ["template", null] } },
      { visibility: "system", kind: "template" },
    ],
    isArchived: { $ne: true },
  });
  return count === ids.length;
};

router.get("/", async (req, res, next) => {
  try {
    await ensureDefaultPlanTemplates();
    const ownerFilter =
      req.user.role === "Admin"
        ? {}
        : { $or: [{ visibility: "system" }, { ownerId: req.user.id }] };
    const templates = await PlanTemplate.find({
      ...ownerFilter,
      isArchived: { $ne: true },
    })
      .sort({ visibility: -1, level: 1, name: 1 })
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (req.user.role === "Cliente" && req.user.trainingMode === "coach_managed") {
      return res.status(403).json({ error: "Tu coach administra tus plantillas" });
    }
    const parsed = readPayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const isSystem = req.body.visibility === "system" && req.user.role === "Admin";
    if (!(await hasValidRoutineSources(parsed.value.weeklySchedule, req.user.id))) {
      return res.status(400).json({ error: "Una rutina base no esta disponible" });
    }
    const template = await PlanTemplate.create({
      _id: `plan_template_${crypto.randomUUID()}`,
      ...parsed.value,
      ownerId: isSystem ? null : req.user.id,
      visibility: isSystem ? "system" : "private",
      version: 1,
    });
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const template = await PlanTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Plantilla no encontrada" });
    const canEdit =
      req.user.role === "Admin" ||
      (template.visibility === "private" && template.ownerId === req.user.id);
    if (!canEdit) return res.status(403).json({ error: "No autorizado" });
    const parsed = readPayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const sourceOwnerId = template.ownerId || req.user.id;
    if (!(await hasValidRoutineSources(parsed.value.weeklySchedule, sourceOwnerId))) {
      return res.status(400).json({ error: "Una rutina base no esta disponible" });
    }
    Object.assign(template, parsed.value);
    template.version += 1;
    await template.save();
    res.json(template);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const template = await PlanTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Plantilla no encontrada" });
    if (req.user.role === "Admin") {
      await template.deleteOne();
      return res.json({ ok: true, deleted: true });
    }
    if (template.visibility !== "private" || template.ownerId !== req.user.id) {
      return res.status(403).json({ error: "No autorizado" });
    }
    template.isArchived = true;
    await template.save();
    res.json({ ok: true, archived: true });
  } catch (error) {
    next(error);
  }
});

export default router;
