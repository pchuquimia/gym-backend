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
import {
  bumpCacheVersion,
  getCache,
  getCacheVersion,
  setCache,
} from "../services/cacheService.js";
import {
  getExerciseLanguage,
  localizeExerciseReferences,
} from "../utils/exerciseLocalization.js";
import { hasPremiumFeature, PREMIUM_FEATURES } from "../utils/subscription.js";
import { isEmailConfigured } from "../config/email.js";
import { syncTrainingPlanLifecycle } from "../utils/trainingPlanLifecycle.js";
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

const loadDashboardCore = async ({ req, res, ownerId, today }) => {
  const [
    activePlan,
    scheduledPlan,
    draftPlan,
    latestCompletedPlan,
    weighIns,
    hydrationEntries,
    profileUser,
    todayCheckIn,
    todayPhotos,
    todayMeasurement,
    coachWorkflow,
    finalAssessment,
  ] = await measureDatabase(
    res,
    () =>
      Promise.all([
        TrainingPlan.findOne({ athleteId: ownerId, status: "active" })
          .sort({ updatedAt: -1 })
          .lean(),
        TrainingPlan.findOne({ athleteId: ownerId, status: "scheduled" })
          .sort({ startDate: 1, updatedAt: -1 })
          .select("name status startDate endDate durationWeeks")
          .lean(),
        req.user.assignedTrainerId
          ? TrainingPlan.findOne({
              athleteId: ownerId,
              coachId: String(req.user.assignedTrainerId),
              status: "draft",
            })
              .sort({ updatedAt: -1 })
              .select("name status updatedAt")
              .lean()
          : Promise.resolve(null),
        TrainingPlan.findOne({
          athleteId: ownerId,
          status: "completed",
          ...(req.user.assignedTrainerId
            ? { coachId: String(req.user.assignedTrainerId) }
            : { coachId: null }),
        })
          .sort({ updatedAt: -1 })
          .lean(),
        WeightEntry.find({ ownerId }).sort({ dateKey: -1 }).limit(2).lean(),
        HydrationEntry.find({ ownerId, dateKey: today })
          .sort({ createdAt: 1, _id: 1 })
          .lean(),
        User.findById(ownerId)
          .select("profile security +googleSubject +facebookSubject")
          .lean(),
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
    { operations: 10 + (req.user.assignedTrainerId ? 2 : 0) },
  );

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

  return {
    ownerId,
    generatedAt: new Date().toISOString(),
    activePlan: activePlan || null,
    planning: activePlan
      ? { status: "active", name: activePlan.name }
      : scheduledPlan
        ? {
            status: "scheduled",
            name: scheduledPlan.name,
            startDate: scheduledPlan.startDate,
          }
        : draftPlan
          ? { status: "draft", name: draftPlan.name }
          : { status: "awaiting_plan" },
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
  };
};

const loadDashboardActivity = async ({
  req,
  res,
  ownerFilter,
  ownerId,
}) => {
  const [summaries, routines, preference] = await measureDatabase(
    res,
    () =>
      Promise.all([
        Training.find(ownerFilter, SUMMARY_FIELDS)
          .sort({ date: -1, _id: -1 })
          .limit(120)
          .lean(),
        Routine.find({ ownerId, isArchived: { $ne: true } }).lean(),
        Preference.findOne({ userId: req.user.id }).lean(),
      ]),
    { operations: 3 },
  );

  const localizedRoutines = await measureDatabase(res, () =>
    localizeExerciseReferences(routines, getExerciseLanguage(req)),
  );

  return {
    payload: {
      ownerId,
      generatedAt: new Date().toISOString(),
      trainings: {
        summaries,
      },
      routines: localizedRoutines,
      preference: normalizePreference(preference, req.user.id),
    },
    intelligenceSource: null,
  };
};

const loadDashboardAnalytics = async ({ res, ownerId, today, advanced }) => {
  const [dailyMetrics, intelligenceResult] = await measureDatabase(
    res,
    () =>
      Promise.all([
        AthleteDailyMetric.find({ ownerId })
          .sort({ dateKey: -1 })
          .limit(120)
          .lean(),
        advanced
          ? getAthleteIntelligence({ ownerId, advanced, today })
          : Promise.resolve({ data: null, source: "disabled" }),
      ]),
    { operations: 1 + (advanced ? 1 : 0) },
  );
  return {
    payload: {
      ownerId,
      generatedAt: new Date().toISOString(),
      dailyMetrics,
      intelligence: intelligenceResult.data,
    },
    intelligenceSource: intelligenceResult.source,
  };
};

const loadDashboardHistory = async ({ req, res, ownerFilter, ownerId }) => {
  const details = await measureDatabase(res, () =>
    Training.find(ownerFilter, DETAIL_FIELDS)
      .sort({ date: -1, _id: -1 })
      .limit(45)
      .lean(),
  );
  const localizedDetails = await measureDatabase(res, () =>
    localizeExerciseReferences(details, getExerciseLanguage(req)),
  );
  return {
    payload: {
      ownerId,
      generatedAt: new Date().toISOString(),
      trainings: { details: localizedDetails },
    },
    intelligenceSource: null,
  };
};

const serveDashboardSection = async (req, res, next, section) => {
  try {
    const ownerFilter = await getAccessibleOwnerFilter(req);
    const ownerId = String(ownerFilter.ownerId);
    const today = String(
      req.query.today || new Date().toISOString().slice(0, 10),
    );
    const advanced =
      hasPremiumFeature(req.user, PREMIUM_FEATURES.LOAD_RECOVERY) &&
      hasPremiumFeature(req.user, PREMIUM_FEATURES.EXERCISE_PROGRESSION);
    const cacheNamespace = `dashboard:${ownerId}`;
    let cacheVersion = await getCacheVersion(cacheNamespace);
    const buildCacheKey = () =>
      `${cacheNamespace}:v${cacheVersion}:${req.user.id}:${advanced ? "advanced" : "basic"}:${today}:${section}`;
    let cacheKey = buildCacheKey();
    const cached = await getCache(cacheKey);
    if (cached) {
      res.set("Cache-Control", "private, no-store");
      res.set("X-Data-Cache", `BOOTSTRAP-${section.toUpperCase()}-HIT`);
      res.set("X-Dashboard-Section", section);
      if (cached.intelligenceSource) {
        res.set(
          "X-Intelligence-Source",
          String(cached.intelligenceSource).toUpperCase(),
        );
      }
      return res.json(cached.payload || cached);
    }

    if (section === "core" || section === "all") {
      const lifecycleChanged = await syncTrainingPlanLifecycle(ownerId);
      if (lifecycleChanged) {
        cacheVersion = await bumpCacheVersion(cacheNamespace);
        cacheKey = buildCacheKey();
      }
    }

    let result;
    if (section === "core") {
      result = {
        payload: await loadDashboardCore({ req, res, ownerId, today }),
        intelligenceSource: null,
      };
    } else if (section === "activity") {
      result = await loadDashboardActivity({
        req,
        res,
        ownerFilter,
        ownerId,
      });
    } else if (section === "analytics") {
      result = await loadDashboardAnalytics({
        res,
        ownerId,
        today,
        advanced,
      });
    } else if (section === "history") {
      result = await loadDashboardHistory({
        req,
        res,
        ownerFilter,
        ownerId,
      });
    } else {
      const [core, activity, history, analytics] = await Promise.all([
        loadDashboardCore({ req, res, ownerId, today }),
        loadDashboardActivity({
          req,
          res,
          ownerFilter,
          ownerId,
        }),
        loadDashboardHistory({ req, res, ownerFilter, ownerId }),
        loadDashboardAnalytics({ res, ownerId, today, advanced }),
      ]);
      result = {
        payload: {
          ...activity.payload,
          ...analytics.payload,
          ...core,
          trainings: {
            ...(activity.payload.trainings || {}),
            ...(history.payload.trainings || {}),
          },
        },
        intelligenceSource: analytics.intelligenceSource,
      };
    }

    void setCache(cacheKey, result, section === "core" ? 30 : 60).catch(
      (error) => {
        console.warn(
          `[dashboard] No se pudo persistir ${section} en cache: ${error.message}`,
        );
      },
    );
    res.set("Cache-Control", "private, no-store");
    res.set("X-Data-Cache", `BOOTSTRAP-${section.toUpperCase()}-MISS`);
    res.set("X-Dashboard-Section", section);
    if (result.intelligenceSource) {
      res.set(
        "X-Intelligence-Source",
        String(result.intelligenceSource).toUpperCase(),
      );
    }
    res.json(result.payload);
  } catch (error) {
    next(error);
  }
};

router.use(protect);
router.get("/bootstrap/core", (req, res, next) =>
  serveDashboardSection(req, res, next, "core"),
);
router.get("/bootstrap/activity", (req, res, next) =>
  serveDashboardSection(req, res, next, "activity"),
);
router.get("/bootstrap/history", (req, res, next) =>
  serveDashboardSection(req, res, next, "history"),
);
router.get("/bootstrap/analytics", (req, res, next) =>
  serveDashboardSection(req, res, next, "analytics"),
);
router.get("/bootstrap", (req, res, next) =>
  serveDashboardSection(req, res, next, "all"),
);

export default router;
