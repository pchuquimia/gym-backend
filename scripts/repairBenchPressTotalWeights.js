import "dotenv/config";
import mongoose from "mongoose";
import AthleteDailyMetric from "../src/models/AthleteDailyMetric.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import { getTrainingLoadMetrics } from "../src/utils/trainingLoad.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");

const APPLY = process.argv.includes("--apply");
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const EXERCISE_ID = "dataset-hasane-0025";
const CUTOFF_DATE = "2026-08-14";
const BAR_WEIGHT_KG = 20;
const REPAIR_TYPE = "bench-press-per-side-to-total-v1";

const toTotalWeight = (value) => {
  if (value === null || value === undefined || value === "") return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return Math.round((numeric * 2 + BAR_WEIGHT_KG) * 100) / 100;
};

const convertPreviousText = (value = "") =>
  String(value).replace(/(\d+(?:[.,]\d+)?)\s*kg/gi, (match, amount) => {
    const total = toTotalWeight(String(amount).replace(",", "."));
    return Number.isFinite(Number(total)) ? `${total} kg` : match;
  });

const convertTrainingExercise = (exercise) => {
  exercise.sets.forEach((set) => {
    set.weightKg = toTotalWeight(set.weightKg);
    set.entries.forEach((entry) => {
      entry.weightKg = toTotalWeight(entry.weightKg);
      if (entry.previousText) {
        entry.previousText = convertPreviousText(entry.previousText);
      }
    });
  });
  exercise.weightBasis = "total";
  exercise.barWeightKg = 0;
  exercise.implementCount = 1;
};

const convertSession = (session) => {
  session.sets.forEach((set) => {
    set.weight = toTotalWeight(set.weight);
  });
  session.weightBasis = "total";
  session.barWeightKg = 0;
  session.implementCount = 1;
};

const summarizeTraining = (training) => ({
  id: String(training._id),
  date: training.date,
  weights: training.exercises
    .filter((exercise) => String(exercise.exerciseId) === EXERCISE_ID)
    .flatMap((exercise) =>
      exercise.sets.flatMap((set) =>
        set.entries.length
          ? set.entries.map((entry) => entry.weightKg)
          : [set.weightKg],
      ),
    ),
});

const refreshDailyMetric = async (dateKey, dbSession) => {
  const trainings = await Training.find({ ownerId: OWNER_ID, date: dateKey })
    .session(dbSession)
    .lean();
  const totalVolume = trainings.reduce(
    (sum, training) => sum + Number(training.totalVolume || 0),
    0,
  );
  await AthleteDailyMetric.updateOne(
    { ownerId: OWNER_ID, dateKey },
    { $set: { totalVolume, sourceUpdatedAt: new Date() } },
    { session: dbSession },
  );
};

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

try {
  const trainingFilter = {
    ownerId: OWNER_ID,
    date: { $lt: CUTOFF_DATE },
    exercises: {
      $elemMatch: {
        exerciseId: EXERCISE_ID,
        weightBasis: { $ne: "total" },
      },
    },
  };
  const sessionFilter = {
    ownerId: OWNER_ID,
    date: { $lt: CUTOFF_DATE },
    exerciseId: EXERCISE_ID,
    weightBasis: { $ne: "total" },
  };
  const [
    trainings,
    sessions,
    recentTrainings,
    allExerciseTrainings,
    latestTrainingWindow,
    allExerciseSessions,
  ] = await Promise.all([
    Training.find(trainingFilter).sort({ date: 1 }),
    Session.find(sessionFilter).sort({ date: 1 }),
    Training.find(
      { ownerId: OWNER_ID, "exercises.exerciseId": EXERCISE_ID },
      "date exercises",
    )
      .sort({ date: -1, createdAt: -1 })
      .limit(3)
      .lean(),
    Training.find(
      { ownerId: OWNER_ID, "exercises.exerciseId": EXERCISE_ID },
      "date exercises",
    ).lean(),
    Training.find({ ownerId: OWNER_ID }, "date exercises")
      .sort({ date: -1, createdAt: -1 })
      .limit(45)
      .lean(),
    Session.find(
      { ownerId: OWNER_ID, exerciseId: EXERCISE_ID },
      "date exerciseId sets",
    ).lean(),
  ]);

  const before = trainings.map(summarizeTraining);
  trainings.forEach((training) => {
    training.exercises
      .filter((exercise) => String(exercise.exerciseId) === EXERCISE_ID)
      .forEach(convertTrainingExercise);
    training.markModified("exercises");
    const loadMetrics = getTrainingLoadMetrics(training.exercises);
    training.totalVolume = loadMetrics.recordedKg;
    training.volumeBreakdown = loadMetrics;
  });
  sessions.forEach(convertSession);
  const after = trainings.map(summarizeTraining);

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    ownerId: OWNER_ID,
    exerciseId: EXERCISE_ID,
    cutoffDate: CUTOFF_DATE,
    formula: `(peso por lado × 2) + ${BAR_WEIGHT_KG} kg de barra`,
    trainings: trainings.length,
    sessions: sessions.length,
    sets: before.reduce((sum, item) => sum + item.weights.length, 0),
    dates: [...new Set(before.map((item) => item.date))],
    preview: before.slice(-5).map((item, index) => ({
      date: item.date,
      before: item.weights,
      after: after.slice(-5)[index]?.weights || [],
    })),
    latest: recentTrainings.map((training) => {
      const exercise = training.exercises.find(
        (item) => String(item.exerciseId) === EXERCISE_ID,
      );
      return {
        date: training.date,
        weightBasis: exercise?.weightBasis,
        weights: (exercise?.sets || []).map(
          (set) => set.entries?.[0]?.weightKg ?? set.weightKg,
        ),
        previous: (exercise?.sets || [])
          .map((set) => set.entries?.[0]?.previousText || "")
          .filter(Boolean),
      };
    }),
    analytics: {
      allTrainingRecords: allExerciseTrainings.length,
      recordsInsideCurrent45TrainingWindow: latestTrainingWindow.filter(
        (training) =>
          training.exercises.some(
            (exercise) => String(exercise.exerciseId) === EXERCISE_ID,
          ),
      ).length,
      legacySessionRecordsLoadedSeparately: allExerciseSessions.length,
      currentDetailedTrainingLimit: 45,
    },
  };

  if (!APPLY || (!trainings.length && !sessions.length)) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } else {
    const backupCollection = mongoose.connection.db.collection(
      "databaseRepairBackups",
    );
    const repairKey = `${REPAIR_TYPE}:${new Date().toISOString()}`;
    await backupCollection.insertOne({
      repairKey,
      repairType: REPAIR_TYPE,
      ownerId: OWNER_ID,
      exerciseId: EXERCISE_ID,
      createdAt: new Date(),
      trainings: trainings.map((training) => training.toObject()),
      sessions: sessions.map((session) => session.toObject()),
    });

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        for (const training of trainings) {
          await training.save({ session: dbSession });
        }
        for (const session of sessions) {
          await session.save({ session: dbSession });
        }
        for (const dateKey of report.dates) {
          await refreshDailyMetric(dateKey, dbSession);
        }
      });
    } finally {
      await dbSession.endSession();
    }

    const [remainingTrainings, remainingSessions] = await Promise.all([
      Training.countDocuments(trainingFilter),
      Session.countDocuments(sessionFilter),
    ]);
    console.log(
      JSON.stringify(
        {
          ...report,
          backup: repairKey,
          verified: remainingTrainings === 0 && remainingSessions === 0,
          remainingTrainings,
          remainingSessions,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await mongoose.disconnect();
}
