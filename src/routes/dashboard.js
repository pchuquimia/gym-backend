import { Router } from "express";
import {
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import { measureDatabase } from "../middleware/performanceTiming.js";
import AthleteDailyMetric from "../models/AthleteDailyMetric.js";
import HydrationEntry from "../models/HydrationEntry.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Training from "../models/Training.js";
import TrainingPlan from "../models/TrainingPlan.js";
import User from "../models/User.js";
import WeightEntry from "../models/WeightEntry.js";
import Photo from "../models/Photo.js";
import AthleteCheckIn from "../models/AthleteCheckIn.js";
import AthleteMeasurement from "../models/AthleteMeasurement.js";
import CoachWorkflowSettings from "../models/CoachWorkflowSettings.js";
import AthleteAssessment from "../models/AthleteAssessment.js";
import { getAthleteIntelligence } from "../services/athleteMetricsService.js";
import { getCache, setCache } from "../services/cacheService.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";
import { hasPremiumFeature, PREMIUM_FEATURES } from "../utils/subscription.js";
import { isEmailConfigured } from "../config/email.js";
import {
  buildTrackingMissions,
  resolvePlanFollowUp,
} from "../utils/coachWorkflow.js";

const router = Router();
const SUMMARY_FIELDS =
  "date createdAt routineId routineName trainingPlanId trainingPlanSlotId progressScopeId orderSignature branch durationSeconds durationOverrideSeconds workSeconds restSeconds preparationSeconds pauseSeconds totalVolume volumeBreakdown";
const DETAIL_FIELDS =
  "date createdAt routineId routineName trainingPlanId trainingPlanSlotId progressScopeId orderSignature branch durationSeconds durationOverrideSeconds workSeconds restSeconds preparationSeconds pauseSeconds exerciseDurations.exerciseId exerciseDurations.durationSeconds exerciseDurations.durationOverrideSeconds exerciseDurations.workSeconds exerciseDurations.restSeconds exerciseDurations.preparationSeconds totalVolume volumeBreakdown exercises.exerciseId exercises.exerciseName exercises.muscleGroup exercises.primaryMuscleGroup exercises.loadType exercises.weightBasis exercises.barWeightKg exercises.implementCount exercises.order exercises.plannedOrder exercises.actualOrder exercises.orderContext exercises.movementMode exercises.seriesType exercises.sets.weightKg exercises.sets.reps exercises.sets.done exercises.sets.order exercises.sets.seriesType exercises.sets.entries.weightKg exercises.sets.entries.reps exercises.sets.entries.done exercises.sets.entries.completedAt exercises.sets.entries.order";

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
    const bootstrapCacheKey = `dashboard:${ownerId}:${req.user.id}:${advanced ? "advanced" : "basic"}:${today}`;
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
      latestCompletedPlan,
      dailyMetrics,
      weighIns,
      hydrationEntries,
      profileUser,
      intelligenceResult,
      todayCheckIn,
      todayPhotos,
      todayMeasurement,
      coachWorkflow,
      finalAssessment,
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
        TrainingPlan.findOne({
          athleteId: ownerId,
          status: "completed",
          ...(req.user.assignedTrainerId
            ? { coachId: String(req.user.assignedTrainerId) }
            : { coachId: null }),
        })
          .sort({ updatedAt: -1 })
          .lean(),
        AthleteDailyMetric.find({ ownerId })
          .sort({ dateKey: -1 })
          .limit(120)
          .lean(),
        WeightEntry.find({ ownerId }).sort({ dateKey: -1 }).limit(2).lean(),
        HydrationEntry.find({ ownerId, dateKey: today })
          .sort({ createdAt: 1, _id: 1 })
          .lean(),
        User.findById(ownerId)
          .select("profile security +googleSubject +facebookSubject")
          .lean(),
        advanced
          ? getAthleteIntelligence({ ownerId, advanced, today })
          : Promise.resolve({ data: null, source: "disabled" }),
        AthleteCheckIn.findOne({ athleteId: ownerId, dateKey: today }).lean(),
        Photo.find({
          ownerId,
          date: today,
          type: { $ne: "profile" },
          visibility: "coach",
        })
          .select("view date")
          .lean(),
        AthleteMeasurement.findOne({
          athleteId: ownerId,
          dateKey: today,
        }).lean(),
        req.user.assignedTrainerId
          ? CoachWorkflowSettings.findOne({
              coachId: String(req.user.assignedTrainerId),
            }).lean()
          : Promise.resolve(null),
        AthleteAssessment.findOne({ athleteId: ownerId, type: "final" })
          .sort({ dateKey: -1 })
          .lean(),
      ]),
    );

    const combined = [...details, ...routines];
    const localized = await measureDatabase(res, () =>
      localizeExerciseReferences(combined, getExerciseLanguage(req)),
    );
    const localizedDetails = localized.slice(0, details.length);
    const localizedRoutines = localized.slice(details.length);
    const todayWeighIn = weighIns.find((entry) => entry.dateKey === today);
    const hydrationGoalMl = Math.min(
      6000,
      Math.max(500, Number(profileUser?.profile?.hydrationGoalMl) || 2500),
    );
    const hydrationTotalMl = hydrationEntries.reduce(
      (sum, entry) => sum + Number(entry.amountMl || 0),
      0,
    );
    const completedPlanNeedsAssessment =
      latestCompletedPlan &&
      (!finalAssessment ||
        String(finalAssessment.planId) !== String(latestCompletedPlan._id));
    const trackingPlan =
      activePlan || (completedPlanNeedsAssessment ? latestCompletedPlan : null);
    const trackingPolicy = trackingPlan
      ? resolvePlanFollowUp(trackingPlan, coachWorkflow)
      : null;

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
      followUp: trackingPlan
        ? {
            policy: trackingPolicy,
            missions: buildTrackingMissions({
              plan: trackingPlan,
              followUp: trackingPolicy,
              todayKey: today,
              todayCheckIn,
              todayWeight: todayWeighIn,
              todayPhotos,
              todayMeasurement,
              finalAssessment:
                finalAssessment &&
                String(finalAssessment.planId) === String(trackingPlan._id)
                  ? finalAssessment
                  : null,
            }),
          }
        : { policy: null, missions: [] },
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
      todayHydration: {
        dateKey: today,
        totalMl: hydrationTotalMl,
        goalMl: hydrationGoalMl,
        remainingMl: Math.max(0, hydrationGoalMl - hydrationTotalMl),
        completed: hydrationTotalMl >= hydrationGoalMl,
        progress: Math.min(
          100,
          Math.round((hydrationTotalMl / hydrationGoalMl) * 100),
        ),
      },
      profile: {
        profile: profileUser?.profile || {},
        security: profileUser?.security || {},
        capabilities: {
          emailChange: isEmailConfigured(),
          requiresPasswordForDeletion: !(
            profileUser?.googleSubject || profileUser?.facebookSubject
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
