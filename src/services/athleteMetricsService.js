import AthleteCheckIn from "../models/AthleteCheckIn.js";
import AthleteDailyMetric from "../models/AthleteDailyMetric.js";
import AthleteIntelligenceSnapshot from "../models/AthleteIntelligenceSnapshot.js";
import Training from "../models/Training.js";
import TrainingPlan from "../models/TrainingPlan.js";
import User from "../models/User.js";
import WeightEntry from "../models/WeightEntry.js";
import { buildTrainingIntelligence } from "../utils/trainingIntelligence.js";
import { deleteCache, getCache, setCache } from "./cacheService.js";

const RECORD_LIMIT = 2000;
const INTELLIGENCE_CACHE_TTL_SECONDS = 60;
const TRAINING_INTELLIGENCE_FIELDS =
  "date routineName durationSeconds totalVolume exercises.exerciseId exercises.exerciseName exercises.muscleGroup exercises.primaryMuscleGroup exercises.weightBasis exercises.barWeightKg exercises.implementCount exercises.sets.weightKg exercises.sets.weight exercises.sets.kg exercises.sets.reps exercises.sets.repetitions exercises.sets.done exercises.sets.entries.weightKg exercises.sets.entries.weight exercises.sets.entries.kg exercises.sets.entries.reps exercises.sets.entries.repetitions exercises.sets.entries.done";

export const intelligenceCacheKey = (ownerId, advanced, today) =>
  `intelligence:${ownerId}:${advanced ? "advanced" : "basic"}:${today}`;

const intelligenceVariant = (advanced) => (advanced ? "advanced" : "basic");

export const refreshAthleteDailyMetric = async (ownerId, dateKey) => {
  const [trainings, checkIn, weighIn] = await Promise.all([
    Training.find(
      { ownerId, date: dateKey },
      "durationSeconds totalVolume volumeBreakdown.recordedSets volumeBreakdown.completedSets exercises.exerciseId exercises.primaryMuscleGroup exercises.muscleGroup",
    ).lean(),
    AthleteCheckIn.findOne({ athleteId: ownerId, dateKey }).lean(),
    WeightEntry.findOne({ ownerId, dateKey }).lean(),
  ]);

  if (!trainings.length && !checkIn && !weighIn) {
    await AthleteDailyMetric.deleteOne({ ownerId, dateKey });
    return null;
  }

  const exerciseIds = new Set();
  const muscleGroups = new Set();
  let durationSeconds = 0;
  let totalVolume = 0;
  let recordedSets = 0;
  let completedSets = 0;

  trainings.forEach((training) => {
    durationSeconds += Number(training.durationSeconds || 0);
    totalVolume += Number(training.totalVolume || 0);
    recordedSets += Number(training.volumeBreakdown?.recordedSets || 0);
    completedSets += Number(training.volumeBreakdown?.completedSets || 0);
    (training.exercises || []).forEach((exercise) => {
      if (exercise.exerciseId) exerciseIds.add(String(exercise.exerciseId));
      const group = exercise.primaryMuscleGroup || exercise.muscleGroup || "";
      if (group) muscleGroups.add(group);
    });
  });

  return AthleteDailyMetric.findOneAndUpdate(
    { ownerId, dateKey },
    {
      $set: {
        sessionCount: trainings.length,
        durationSeconds,
        totalVolume,
        recordedSets,
        completedSets,
        exerciseCount: exerciseIds.size,
        muscleGroups: [...muscleGroups],
        readinessScore: checkIn?.readinessScore ?? null,
        readinessState: checkIn?.readinessState || "",
        weightKg: weighIn?.weightKg ?? null,
        sourceUpdatedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
};

const computeTrainingIntelligence = async ({ ownerId, advanced, today }) => {
  const [trainings, checkIns, weighIns, activePlan, athlete] =
    await Promise.all([
      Training.find({ ownerId }, TRAINING_INTELLIGENCE_FIELDS)
        .sort({ date: -1 })
        .limit(RECORD_LIMIT)
        .lean(),
      advanced
        ? AthleteCheckIn.find({ athleteId: ownerId })
            .sort({ dateKey: -1 })
            .limit(30)
            .lean()
        : [],
      advanced
        ? WeightEntry.find({ ownerId }).sort({ dateKey: -1 }).limit(90).lean()
        : [],
      advanced
        ? TrainingPlan.findOne({ athleteId: ownerId, status: "active" })
            .sort({ updatedAt: -1 })
            .select(
              "frequencyTarget goal startDate endDate scheduleMode weeklySchedule",
            )
            .lean()
        : null,
      advanced
        ? User.findById(ownerId).select("profile.goal profile.weight").lean()
        : null,
    ]);
  const storage = /mongodb\.net|mongodb\+srv/i.test(process.env.MONGO_URI || "")
    ? "MongoDB Atlas"
    : "MongoDB";
  return buildTrainingIntelligence(trainings, {
    recordLimit: RECORD_LIMIT,
    storage,
    advanced,
    context: {
      checkIns,
      weighIns,
      activePlan,
      profile: athlete?.profile || {},
      today,
    },
  });
};

export const getAthleteIntelligence = async ({
  ownerId,
  advanced,
  today,
  force = false,
}) => {
  const variant = intelligenceVariant(advanced);
  const cacheKey = intelligenceCacheKey(ownerId, advanced, today);
  if (!force) {
    const cached = await getCache(cacheKey);
    if (cached) return { data: cached, source: "cache" };
    const snapshot = await AthleteIntelligenceSnapshot.findOne({
      ownerId,
      dateKey: today,
      variant,
      dirty: { $ne: true },
    }).lean();
    if (snapshot?.data) {
      await setCache(cacheKey, snapshot.data, INTELLIGENCE_CACHE_TTL_SECONDS);
      return { data: snapshot.data, source: "snapshot" };
    }
  }

  const data = await computeTrainingIntelligence({ ownerId, advanced, today });
  await Promise.all([
    AthleteIntelligenceSnapshot.findOneAndUpdate(
      { ownerId, dateKey: today, variant },
      {
        $set: {
          data,
          dirty: false,
          generatedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ),
    setCache(cacheKey, data, INTELLIGENCE_CACHE_TTL_SECONDS),
  ]);
  return { data, source: "computed" };
};

export const markAthleteIntelligenceDirty = async (ownerId, today) => {
  await Promise.all([
    AthleteIntelligenceSnapshot.updateMany(
      { ownerId },
      { $set: { dirty: true } },
    ),
    deleteCache(
      intelligenceCacheKey(ownerId, false, today),
      intelligenceCacheKey(ownerId, true, today),
      `dashboard:${ownerId}:${ownerId}:basic:${today}`,
      `dashboard:${ownerId}:${ownerId}:advanced:${today}`,
    ),
  ]);
};

export const rebuildAthleteMetrics = async ({ ownerId, dateKey, today }) => {
  await refreshAthleteDailyMetric(ownerId, dateKey);
  await getAthleteIntelligence({
    ownerId,
    advanced: false,
    today,
    force: true,
  });
  await getAthleteIntelligence({
    ownerId,
    advanced: true,
    today,
    force: true,
  });
};
