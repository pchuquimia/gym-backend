import { loadBackendEnvironment } from "../src/config/loadEnv.js";

loadBackendEnvironment();

const [
  { connectDB },
  { default: mongoose },
  { default: Training },
  { default: AthleteCheckIn },
  { default: WeightEntry },
  { default: AthleteDailyMetric },
] = await Promise.all([
  import("../src/config/db.js"),
  import("mongoose"),
  import("../src/models/Training.js"),
  import("../src/models/AthleteCheckIn.js"),
  import("../src/models/WeightEntry.js"),
  import("../src/models/AthleteDailyMetric.js"),
]);

await connectDB(process.env.MONGO_URI || "mongodb://localhost:27017/gym");

const [trainings, checkIns, weighIns] = await Promise.all([
  Training.find(
    { ownerId: { $type: "string", $ne: "" } },
    "ownerId date durationSeconds totalVolume volumeBreakdown.recordedSets volumeBreakdown.completedSets exercises.exerciseId exercises.primaryMuscleGroup exercises.muscleGroup",
  ).lean(),
  AthleteCheckIn.find(
    {},
    "athleteId dateKey readinessScore readinessState",
  ).lean(),
  WeightEntry.find({}, "ownerId dateKey weightKg").lean(),
]);

const metrics = new Map();
const readMetric = (ownerId, dateKey) => {
  const key = `${ownerId}:${dateKey}`;
  if (!metrics.has(key)) {
    metrics.set(key, {
      ownerId,
      dateKey,
      sessionCount: 0,
      durationSeconds: 0,
      totalVolume: 0,
      recordedSets: 0,
      completedSets: 0,
      exerciseIds: new Set(),
      muscleGroups: new Set(),
      readinessScore: null,
      readinessState: "",
      weightKg: null,
    });
  }
  return metrics.get(key);
};

trainings.forEach((training) => {
  const metric = readMetric(String(training.ownerId), String(training.date));
  metric.sessionCount += 1;
  metric.durationSeconds += Number(training.durationSeconds || 0);
  metric.totalVolume += Number(training.totalVolume || 0);
  metric.recordedSets += Number(training.volumeBreakdown?.recordedSets || 0);
  metric.completedSets += Number(training.volumeBreakdown?.completedSets || 0);
  (training.exercises || []).forEach((exercise) => {
    if (exercise.exerciseId)
      metric.exerciseIds.add(String(exercise.exerciseId));
    const group = exercise.primaryMuscleGroup || exercise.muscleGroup || "";
    if (group) metric.muscleGroups.add(group);
  });
});

checkIns.forEach((checkIn) => {
  const metric = readMetric(String(checkIn.athleteId), String(checkIn.dateKey));
  metric.readinessScore = checkIn.readinessScore ?? null;
  metric.readinessState = checkIn.readinessState || "";
});

weighIns.forEach((weighIn) => {
  const metric = readMetric(String(weighIn.ownerId), String(weighIn.dateKey));
  metric.weightKg = weighIn.weightKg ?? null;
});

const operations = [...metrics.values()].map((metric) => ({
  updateOne: {
    filter: { ownerId: metric.ownerId, dateKey: metric.dateKey },
    update: {
      $set: {
        sessionCount: metric.sessionCount,
        durationSeconds: metric.durationSeconds,
        totalVolume: metric.totalVolume,
        recordedSets: metric.recordedSets,
        completedSets: metric.completedSets,
        exerciseCount: metric.exerciseIds.size,
        muscleGroups: [...metric.muscleGroups],
        readinessScore: metric.readinessScore,
        readinessState: metric.readinessState,
        weightKg: metric.weightKg,
        sourceUpdatedAt: new Date(),
      },
    },
    upsert: true,
  },
}));

if (operations.length) {
  await AthleteDailyMetric.bulkWrite(operations, { ordered: false });
}
console.log(
  JSON.stringify({
    dailyMetrics: operations.length,
    trainings: trainings.length,
  }),
);
await mongoose.disconnect();
