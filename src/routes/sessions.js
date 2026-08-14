import { Router } from "express";
import {
  authorizeRoles,
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import Session from "../models/Session.js";
import { normalizeHistoricalExerciseConfig } from "../utils/historicalExerciseConfig.js";

const router = Router();

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req);
    const sessions = await Session.find(filter).lean();
    res.set("Cache-Control", "private, no-store");
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
    const isSupervised = String(ownerId) !== String(req.user.id);
    const session = await Session.create({
      ...req.body,
      ownerId,
      sessionType: isSupervised ? "supervised" : "personal",
      startedBy: req.user.id,
      supervisedBy: isSupervised ? req.user.id : null,
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/config", authorizeRoles("Admin"), async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "No encontrado" });
    if (!(await ensureCanAccessOwner(req, session.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }

    Object.assign(
      session,
      normalizeHistoricalExerciseConfig(req.body, session),
    );
    await session.save();

    res.set("Cache-Control", "private, no-store");
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Session.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    const ownsSession = String(current.ownerId) === String(req.user.id);
    const supervisedByCoach =
      ["Admin", "Entrenador"].includes(req.user.role) &&
      current.sessionType === "supervised" &&
      String(current.supervisedBy || "") === String(req.user.id) &&
      (await ensureCanAccessOwner(req, current.ownerId));
    if (!ownsSession && !supervisedByCoach) {
      return res.status(403).json({ error: "No autorizado" });
    }
    await Session.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
