import "dotenv/config";
import mongoose from "mongoose";
import AthleteDailyMetric from "../src/models/AthleteDailyMetric.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import { getTrainingLoadMetrics } from "../src/utils/trainingLoad.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");

const APPLY = process.argv.includes("--apply");
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const EXERCISE_ID = "dataset-hasane-0314";
const REPAIR_TYPE = "incline-dumbbell-press-per-implement-v1";

const needsRepair = (exercise) =>
  String(exercise.exerciseId || "") === EXERCISE_ID &&
  (exercise.weightBasis !== "per_implement" ||
    Number(exercise.implementCount || 1) !== 2);

const normalizeExercise = (exercise) => {
  exercise.weightBasis = "per_implement";
  exercise.implementCount = 2;
  exercise.barWeightKg = 0;
};

const normalizeSession = (session) => {
  session.weightBasis = "per_implement";
  session.implementCount = 2;
  session.barWeightKg = 0;
};

const readWeights = (exercise) =>
  (exercise.sets || []).flatMap((set) =>
    set.entries?.length
      ? set.entries.map((entry) => entry.weightKg)
      : [set.weightKg],
  );

const refreshDailyMetric = async (dateKey, dbSession) => {
  const trainings = await Training.find({ ownerId: OWNER_ID, date: dateKey })
    .session(dbSession)
    .lean();
  await AthleteDailyMetric.updateOne(
    { ownerId: OWNER_ID, dateKey },
    {
      $set: {
        totalVolume: trainings.reduce(
          (sum, training) => sum + Number(training.totalVolume || 0),
          0,
        ),
        sourceUpdatedAt: new Date(),
      },
    },
    { session: dbSession },
  );
};

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
try {
  const trainingFilter = {
    ownerId: OWNER_ID,
    exercises: {
      $elemMatch: {
        exerciseId: EXERCISE_ID,
        $or: [
          { weightBasis: { $ne: "per_implement" } },
          { implementCount: { $ne: 2 } },
        ],
      },
    },
  };
  const sessionFilter = {
    ownerId: OWNER_ID,
    exerciseId: EXERCISE_ID,
    $or: [
      { weightBasis: { $ne: "per_implement" } },
      { implementCount: { $ne: 2 } },
    ],
  };
  const [trainings, sessions] = await Promise.all([
    Training.find(trainingFilter).sort({ date: 1 }),
    Session.find(sessionFilter).sort({ date: 1 }),
  ]);

  const affected = trainings.map((training) => {
    const exercise = training.exercises.find(needsRepair);
    return {
      date: training.date,
      weightsPerDumbbell: readWeights(exercise),
      combinedWeights: readWeights(exercise).map((weight) =>
        Number.isFinite(Number(weight)) ? Number(weight) * 2 : weight,
      ),
    };
  });
  trainings.forEach((training) => {
    training.exercises.filter(needsRepair).forEach(normalizeExercise);
    training.markModified("exercises");
    const metrics = getTrainingLoadMetrics(training.exercises);
    training.totalVolume = metrics.recordedKg;
    training.volumeBreakdown = metrics;
  });
  sessions.forEach(normalizeSession);

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    ownerId: OWNER_ID,
    exerciseId: EXERCISE_ID,
    convention: "peso de una mancuerna × 2 unidades",
    trainings: trainings.length,
    sessions: sessions.length,
    sets: affected.reduce(
      (sum, training) => sum + training.weightsPerDumbbell.length,
      0,
    ),
    dates: [...new Set(affected.map((training) => training.date))],
    preview: affected.slice(-5),
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
