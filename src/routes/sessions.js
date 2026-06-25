import { Router } from "express";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Session from "../models/Session.js";

const router = Router();

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req);
    const sessions = await Session.find(filter).lean();
    res.json(sessions);
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
    const session = await Session.create({ ...req.body, ownerId });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Session.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await Session.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
