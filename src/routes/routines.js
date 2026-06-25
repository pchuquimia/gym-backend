import { Router } from "express";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";

const router = Router();

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req);
    const routines = await Routine.find(filter).lean();
    res.json(routines);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = req.body.ownerId || req.user.id;
    if (!(await ensureCanAccessOwner(req, ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const routine = await Routine.create({ ...req.body, ownerId });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await Routine.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const payload = { ...req.body, ownerId: current.ownerId || req.user.id };
    if (req.body.ownerId && req.user.role === "Admin") {
      payload.ownerId = req.body.ownerId;
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
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await Routine.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
