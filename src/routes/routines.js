import { Router } from "express";
import crypto from "crypto";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";

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
    const filter = await getAccessibleOwnerFilter(req);
    const routines = await Routine.find(filter).lean();
    res.set("Cache-Control", "private, no-store");
    res.json(routines);
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
    const routine = await Routine.create(payload);
    res.status(201).json(routine);
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
    const payload = { ...req.body, ownerId: current.ownerId || req.user.id };
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
    res.json(routine);
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
    await Routine.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
