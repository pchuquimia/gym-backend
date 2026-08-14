import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";

loadBackendEnvironment();

const [{ connectDB }, { default: Exercise }, { default: Routine }, { default: Training }] =
  await Promise.all([
    import("../src/config/db.js"),
    import("../src/models/Exercise.js"),
    import("../src/models/Routine.js"),
    import("../src/models/Training.js"),
  ]);

const getArgument = (name) => {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
};

const exerciseId = getArgument("--exercise-id");
const shouldApply = process.argv.includes("--apply");
if (!exerciseId) throw new Error("Falta --exercise-id=<id>");

await connectDB(process.env.MONGO_URI);

const exerciseFilter = { "exercises.exerciseId": exerciseId };
const [exercise, routines, trainings] = await Promise.all([
  Exercise.findById(exerciseId).lean(),
  Routine.find(exerciseFilter).lean(),
  Training.find(exerciseFilter).sort({ date: 1 }).lean(),
]);

if (!exercise) throw new Error(`No existe el ejercicio ${exerciseId}`);

const summarizeModes = (documents) => {
  const summary = new Map();
  documents.forEach((document) => {
    (document.exercises || [])
      .filter((item) => String(item.exerciseId) === exerciseId)
      .forEach((item) => {
        const mode = item.movementMode || "missing";
        summary.set(mode, (summary.get(mode) || 0) + 1);
      });
  });
  return Object.fromEntries(summary);
};

const before = {
  exercise: {
    id: String(exercise._id),
    movementMode: exercise.movementMode || "missing",
    supportsUnilateral: Boolean(exercise.supportsUnilateral),
  },
  routines: { count: routines.length, modes: summarizeModes(routines) },
  trainings: { count: trainings.length, modes: summarizeModes(trainings) },
};

if (!shouldApply) {
  console.log(JSON.stringify({ dryRun: true, exerciseId, before }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

const backupRoot = path.resolve(process.cwd(), "../artifacts/database-backups");
await fs.mkdir(backupRoot, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(
  backupRoot,
  `exercise-movement-${exerciseId}-${timestamp}.json`,
);
await fs.writeFile(
  backupPath,
  JSON.stringify({ createdAt: new Date().toISOString(), exercise, routines, trainings }, null, 2),
  "utf8",
);

const dbSession = await mongoose.startSession();
let modified = null;
try {
  await dbSession.withTransaction(async () => {
    const [exerciseResult, routineResult, trainingResult] = await Promise.all([
      Exercise.updateOne(
        { _id: exerciseId },
        { $set: { movementMode: "unilateral", supportsUnilateral: true } },
        { session: dbSession },
      ),
      Routine.updateMany(
        exerciseFilter,
        {
          $set: {
            "exercises.$[exercise].movementMode": "unilateral",
            "exercises.$[exercise].supportsUnilateral": true,
          },
        },
        {
          arrayFilters: [{ "exercise.exerciseId": exerciseId }],
          session: dbSession,
        },
      ),
      Training.updateMany(
        exerciseFilter,
        { $set: { "exercises.$[exercise].movementMode": "unilateral" } },
        {
          arrayFilters: [{ "exercise.exerciseId": exerciseId }],
          session: dbSession,
        },
      ),
    ]);
    modified = {
      exercise: exerciseResult.modifiedCount,
      routines: routineResult.modifiedCount,
      trainings: trainingResult.modifiedCount,
    };
  });
} finally {
  await dbSession.endSession();
}

const [updatedExercise, updatedRoutines, updatedTrainings] = await Promise.all([
  Exercise.findById(exerciseId).lean(),
  Routine.find(exerciseFilter).lean(),
  Training.find(exerciseFilter).lean(),
]);
const after = {
  exercise: {
    movementMode: updatedExercise?.movementMode || "missing",
    supportsUnilateral: Boolean(updatedExercise?.supportsUnilateral),
  },
  routines: {
    count: updatedRoutines.length,
    modes: summarizeModes(updatedRoutines),
  },
  trainings: {
    count: updatedTrainings.length,
    modes: summarizeModes(updatedTrainings),
  },
};

console.log(
  JSON.stringify(
    { ok: true, exerciseId, backupPath, before, modified, after },
    null,
    2,
  ),
);
await mongoose.disconnect();
