import { Router } from "express";
import {
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import { measureDatabase } from "../middleware/performanceTiming.js";
import AthleteDailyMetric from "../models/AthleteDailyMetric.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Training from "../models/Training.js";
import TrainingPlan from "../models/TrainingPlan.js";
import User from "../models/User.js";
import WeightEntry from "../models/WeightEntry.js";
import { getAthleteIntelligence } from "../services/athleteMetricsService.js";
import { getCache, setCache } from "../services/cacheService.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";
import { hasPremiumFeature, PREMIUM_FEATURES } from "../utils/subscription.js";

const router = Router();
const SUMMARY_FIELDS =
  "date createdAt routineId routineName trainingPlanId trainingPlanSlotId progressScopeId orderSignature branch durationSeconds durationOverrideSeconds workSeconds restSeconds pauseSeconds totalVolume volumeBreakdown";
const DETAIL_FIELDS =
  "date createdAt routineId routineName trainingPlanId trainingPlanSlotId progressScopeId orderSignature branch durationSeconds durationOverrideSeconds workSeconds restSeconds pauseSeconds exerciseDurations.exerciseId exerciseDurations.durationSeconds exerciseDurations.durationOverrideSeconds exerciseDurations.workSeconds exerciseDurations.restSeconds totalVolume volumeBreakdown exercises.exerciseId exercises.exerciseName exercises.muscleGroup exercises.primaryMuscleGroup exercises.loadType exercises.weightBasis exercises.barWeightKg exercises.implementCount exercises.order exercises.plannedOrder exercises.actualOrder exercises.orderContext exercises.movementMode exercises.seriesType exercises.sets.weightKg exercises.sets.reps exercises.sets.done exercises.sets.order exercises.sets.seriesType exercises.sets.entries.weightKg exercises.sets.entries.reps exercises.sets.entries.done exercises.sets.entries.completedAt exercises.sets.entries.order";

const normalizePreference = (preference, userId) => ({
  ...(preference || {}),
  userId,
  branch: preference?.branch || "sopocachi",
  locationMode: preference?.locationMode || "single",
  allowedBranches: preference?.allowedBranches?.length
    ? preference.allowedBranches
    : [preference?.branch || "sopocachi"],
  goals: preference?.goals || {},
});

router.use(protect);

router.get("/bootstrap", async (req, res, next) => {
  try {
    const ownerFilter = await getAccessibleOwnerFilter(req);
    const ownerId = String(ownerFilter.ownerId);
    const today = String(
      req.query.today || new Date().toISOString().slice(0, 10),
    );
    const advanced =
      hasPremiumFeature(req.user, PREMIUM_FEATURES.LOAD_RECOVERY) &&
      hasPremiumFeature(req.user, PREMIUM_FEATURES.EXERCISE_PROGRESSION);
    const bootstrapCacheKey = `dashboard:${req.user.id}:${ownerId}:${advanced ? "advanced" : "basic"}:${today}`;
    const cachedBootstrap = await getCache(bootstrapCacheKey);
    if (cachedBootstrap) {
      res.set("Cache-Control", "private, no-store");
      res.set("X-Data-Cache", "BOOTSTRAP-HIT");
      return res.json(cachedBootstrap);
    }

    const [
      summaries,
      details,
      routines,
      preference,
      activePlan,
      dailyMetrics,
      weighIns,
      profileUser,
      intelligenceResult,
    ] = await measureDatabase(res, () =>
      Promise.all([
        Training.find(ownerFilter, SUMMARY_FIELDS)
          .sort({ date: -1, _id: -1 })
          .limit(120)
          .lean(),
        Training.find(ownerFilter, DETAIL_FIELDS)
          .sort({ date: -1, _id: -1 })
          .limit(45)
          .lean(),
        Routine.find({ ownerId, isArchived: { $ne: true } }).lean(),
        Preference.findOne({ userId: req.user.id }).lean(),
        TrainingPlan.findOne({ athleteId: ownerId, status: "active" })
          .sort({ updatedAt: -1 })
          .lean(),
        AthleteDailyMetric.find({ ownerId })
          .sort({ dateKey: -1 })
          .limit(120)
          .lean(),
        WeightEntry.find({ ownerId }).sort({ dateKey: -1 }).limit(2).lean(),
        User.findById(req.user.id).select("profile security").lean(),
        advanced
          ? getAthleteIntelligence({ ownerId, advanced, today })
          : Promise.resolve({ data: null, source: "disabled" }),
      ]),
    );

    const combined = [...details, ...routines];
    const localized = await measureDatabase(res, () =>
      localizeExerciseReferences(combined, getExerciseLanguage(req)),
    );
    const localizedDetails = localized.slice(0, details.length);
    const localizedRoutines = localized.slice(details.length);
    const todayWeighIn = weighIns.find((entry) => entry.dateKey === today);

    const response = {
      ownerId,
      generatedAt: new Date().toISOString(),
      trainings: {
        summaries,
        details: localizedDetails,
      },
      routines: localizedRoutines,
      preference: normalizePreference(preference, req.user.id),
      activePlan: activePlan || null,
      dailyMetrics,
      todayWeighIn: {
        entries: todayWeighIn ? [todayWeighIn] : [],
        summary: {
          todayKey: today,
          completedToday: Boolean(todayWeighIn),
          latest: weighIns[0] || null,
          previous: weighIns[1] || null,
        },
      },
      profile: {
        profile: profileUser?.profile || {},
        security: profileUser?.security || {},
        capabilities: {
          emailChange: Boolean(
            process.env.SMTP_HOST &&
              process.env.SMTP_USER &&
              process.env.SMTP_PASSWORD,
          ),
        },
      },
      intelligence: intelligenceResult.data,
    };
    await setCache(bootstrapCacheKey, response, 20);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Data-Cache", intelligenceResult.source.toUpperCase());
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
