import { Router } from "express";
import {
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import { measureDatabase } from "../middleware/performanceTiming.js";
import { getAthleteIntelligence } from "../services/athleteMetricsService.js";
import { hasPremiumFeature, PREMIUM_FEATURES } from "../utils/subscription.js";

const router = Router();

router.use(protect);

router.get("/intelligence", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req);
    const ownerId = String(filter.ownerId);
    const advanced =
      hasPremiumFeature(req.user, PREMIUM_FEATURES.LOAD_RECOVERY) &&
      hasPremiumFeature(req.user, PREMIUM_FEATURES.EXERCISE_PROGRESSION);
    const today = String(
      req.query.today || new Date().toISOString().slice(0, 10),
    );
    const result = await measureDatabase(res, () =>
      getAthleteIntelligence({ ownerId, advanced, today }),
    );
    res.set("Cache-Control", "private, no-store");
    res.set("X-Data-Cache", result.source.toUpperCase());
    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
