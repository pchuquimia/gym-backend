import { Router } from "express";
import AthleteMeasurement from "../models/AthleteMeasurement.js";
import TrainingPlan from "../models/TrainingPlan.js";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import { deleteCacheByPrefix } from "../services/cacheService.js";

const router = Router();
const FIELDS = ["waist", "chest", "hips", "arm", "thigh", "calf"];
const dateKey = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const athleteId = String(req.query.athleteId || req.user.id);
    if (!(await ensureCanAccessOwner(req, athleteId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const measurements = await AthleteMeasurement.find({ athleteId })
      .sort({ dateKey: -1 })
      .limit(52)
      .lean();
    res.set("Cache-Control", "private, no-store");
    return res.json({ measurements });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const athleteId = String(req.body.athleteId || req.user.id);
    if (!(await ensureCanAccessOwner(req, athleteId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const submittedDate = String(req.body.dateKey || dateKey());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(submittedDate)) {
      return res.status(400).json({ error: "Fecha invalida" });
    }
    const values = {};
    FIELDS.forEach((field) => {
      if (req.body.values?.[field] === "" || req.body.values?.[field] == null) {
        values[field] = null;
        return;
      }
      const number = Number(req.body.values[field]);
      if (!Number.isFinite(number) || number <= 0 || number > 400) {
        values[field] = null;
        return;
      }
      values[field] = number;
    });
    if (!Object.values(values).some((value) => value !== null)) {
      return res.status(400).json({ error: "Registra al menos una medida" });
    }
    const activePlan = await TrainingPlan.findOne({
      athleteId,
      status: "active",
    })
      .select("_id coachId")
      .lean();
    const measurement = await AthleteMeasurement.findOneAndUpdate(
      { athleteId, dateKey: submittedDate },
      {
        $set: {
          values,
          notes: String(req.body.notes || "")
            .trim()
            .slice(0, 500),
          planId: activePlan?._id ? String(activePlan._id) : null,
          coachId: activePlan?.coachId || null,
          submittedBy: req.user.id,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
    await deleteCacheByPrefix(`dashboard:${athleteId}:`);
    return res.status(201).json({ measurement });
  } catch (error) {
    return next(error);
  }
});

export default router;
