import { Router } from "express";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import Preference from "../models/Preference.js";

const router = Router();
const normalizeBranch = (value) =>
  value === "miraflores" || value === "sopocachi" ? value : "sopocachi";

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    if (!(await ensureCanAccessOwner(req, userId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const pref = await Preference.findOne({ userId }).lean();
    res.set("Cache-Control", "no-store");
    res.json(pref || { userId, branch: "sopocachi", goals: {} });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const userId = req.body.userId || req.user.id;
    if (!(await ensureCanAccessOwner(req, userId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const update = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "branch")) {
      update.branch = normalizeBranch(req.body.branch);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "goals")) {
      update.goals = req.body.goals || {};
    }

    const pref = await Preference.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.set("Cache-Control", "no-store");
    res.status(201).json(pref);
  } catch (err) {
    next(err);
  }
});

export default router;
