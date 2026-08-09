import { Router } from "express";
import { getAccessibleOwnerFilter, protect } from "../middleware/authMiddleware.js";
import Training from "../models/Training.js";
import { buildTrainingIntelligence } from "../utils/trainingIntelligence.js";

const router = Router();
const RECORD_LIMIT = 2000;

router.use(protect);

router.get("/intelligence", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req);
    const trainings = await Training.find(
      filter,
      "date routineName durationSeconds totalVolume exercises.exerciseId exercises.exerciseName exercises.muscleGroup exercises.sets",
    )
      .sort({ date: -1 })
      .limit(RECORD_LIMIT)
      .lean();
    const storage = /mongodb\.net|mongodb\+srv/i.test(process.env.MONGO_URI || "")
      ? "MongoDB Atlas"
      : "MongoDB";
    const result = buildTrainingIntelligence(trainings, {
      recordLimit: RECORD_LIMIT,
      storage,
    });
    res.set("Cache-Control", "private, no-store");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
