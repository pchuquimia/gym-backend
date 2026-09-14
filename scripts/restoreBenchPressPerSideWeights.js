import "dotenv/config";
import mongoose from "mongoose";
import AthleteDailyMetric from "../src/models/AthleteDailyMetric.js";
import Exercise from "../src/models/Exercise.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import { getTrainingLoadMetrics } from "../src/utils/trainingLoad.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");

const APPLY = process.argv.includes("--apply");
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const EXERCISE_ID = "dataset-hasane-0025";
const BAR_WEIGHT_KG = 20;
const REPAIR_TYPE = "bench-press-total-to-per-side-v1";

const toPerSideWeight = (value) => {
  if (value === null || value === undefined || value === "") return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return value;
  return Math.round(((numeric - BAR_WEIGHT_KG) / 2) * 100) / 100;
};

const convertPreviousText = (value = "") =>
  String(value).replace(/(\d+(?:[.,]\d+)?)\s*kg/gi, (match, amount) => {
    const perSide = toPerSideWeight(String(amount).replace(",", "."));
    return Number.isFinite(Number(perSide)) ? `${perSide} kg` : match;
  });

const readTrainingWeights = (training) =>
  training.exercises
    .filter((exercise) => String(exercise.exerciseId) === EXERCISE_ID)
    .flatMap((exercise) =>
      exercise.sets.flatMap((set) =>
        set.entries.length
          ? set.entries.map((entry) => entry.weightKg)
          : [set.weightKg],
      ),
    );

const convertTrainingExercise = (exercise) => {
  if (exercise.weightBasis === "per_side") return;
  exercise.sets.forEach((set) => {
    set.weightKg = toPerSideWeight(set.weightKg);
    set.entries.forEach((entry) => {
      entry.weightKg = toPerSideWeight(entry.weightKg);
      if (entry.previousText) {
        entry.previousText = convertPreviousText(entry.previousText);
      }
    });
  });
  exercise.weightBasis = "per_side";
  exercise.barWeightKg = BAR_WEIGHT_KG;
  exercise.implementCount = 1;
};

const convertSession = (session) => {
  if (session.weightBasis === "per_side") return;
  session.sets.forEach((set) => {
    set.weight = toPerSideWeight(set.weight);
  });
  session.weightBasis = "per_side";
  session.barWeightKg = BAR_WEIGHT_KG;
  session.implementCount = 1;
};

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

await mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10_000,
});

try {
  const [catalogExercise, trainings, sessions] = await Promise.all([
    Exercise.findById(EXERCISE_ID),
    Training.find({
      ownerId: OWNER_ID,
      exercises: {
        $elemMatch: {
          exerciseId: EXERCISE_ID,
          weightBasis: { $ne: "per_side" },
        },
      },
    }).sort({ date: 1 }),
    Session.find({
      ownerId: OWNER_ID,
      exerciseId: EXERCISE_ID,
      weightBasis: { $ne: "per_side" },
    }).sort({ date: 1 }),
  ]);

  if (!catalogExercise) throw new Error("No se encontró el ejercicio");

  const originalTrainings = trainings.map((training) => training.toObject());
  const originalSessions = sessions.map((session) => session.toObject());
  const originalExercise = catalogExercise.toObject();
  const before = trainings.map((training) => ({
    date: training.date,
    weights: readTrainingWeights(training),
  }));

  trainings.forEach((training) => {
    training.exercises
      .filter((exercise) => String(exercise.exerciseId) === EXERCISE_ID)
      .forEach(convertTrainingExercise);
    training.markModified("exercises");
    const metrics = getTrainingLoadMetrics(training.exercises);
    training.totalVolume = metrics.recordedKg;
    training.volumeBreakdown = metrics;
  });
  sessions.forEach(convertSession);
  catalogExercise.weightConfig = {
    basis: "per_side",
    barWeightKg: BAR_WEIGHT_KG,
    implementCount: 1,
  };

  const after = trainings.map((training) => ({
    date: training.date,
    weights: readTrainingWeights(training),
  }));
  const dates = [...new Set(trainings.map((training) => training.date))];
  const report = {
    mode: APPLY ? "apply" : "dry-run",
    exerciseId: EXERCISE_ID,
    convention: `discos por lado; carga efectiva = (registro × 2) + ${BAR_WEIGHT_KG} kg`,
    trainings: trainings.length,
    sessions: sessions.length,
    dates: dates.length,
    preview: before.slice(-5).map((item, index) => ({
      date: item.date,
      totalBefore: item.weights,
      perSideAfter: after.slice(-5)[index]?.weights || [],
    })),
  };

  if (!APPLY || (!trainings.length && !sessions.length)) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const repairKey = `${REPAIR_TYPE}:${new Date().toISOString()}`;
    await mongoose.connection.db.collection("databaseRepairBackups").insertOne({
      repairKey,
      repairType: REPAIR_TYPE,
      ownerId: OWNER_ID,
      exerciseId: EXERCISE_ID,
      createdAt: new Date(),
      exercise: originalExercise,
      trainings: originalTrainings,
      sessions: originalSessions,
    });

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await catalogExercise.save({ session: dbSession });
        for (const training of trainings) {
          await training.save({ session: dbSession });
        }
        for (const session of sessions) {
          await session.save({ session: dbSession });
        }
        for (const dateKey of dates) {
          await refreshDailyMetric(dateKey, dbSession);
        }
      });
    } finally {
      await dbSession.endSession();
    }

    const [remainingTrainings, remainingSessions, updatedExercise] =
      await Promise.all([
        Training.countDocuments({
          ownerId: OWNER_ID,
          exercises: {
            $elemMatch: {
              exerciseId: EXERCISE_ID,
              weightBasis: { $ne: "per_side" },
            },
          },
        }),
        Session.countDocuments({
          ownerId: OWNER_ID,
          exerciseId: EXERCISE_ID,
          weightBasis: { $ne: "per_side" },
        }),
        Exercise.findById(EXERCISE_ID, "weightConfig").lean(),
      ]);
    console.log(
      JSON.stringify(
        {
          ...report,
          backup: repairKey,
          verified:
            remainingTrainings === 0 &&
            remainingSessions === 0 &&
            updatedExercise?.weightConfig?.basis === "per_side" &&
            Number(updatedExercise?.weightConfig?.barWeightKg) ===
              BAR_WEIGHT_KG,
          remainingTrainings,
          remainingSessions,
          weightConfig: updatedExercise?.weightConfig,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await mongoose.disconnect();
}
