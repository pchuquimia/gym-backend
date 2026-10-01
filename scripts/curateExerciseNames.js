import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import Session from "../src/models/Session.js";
import {
  EXERCISE_NAME_CORRECTIONS,
  getCuratedExerciseNamePatch,
} from "../src/utils/exerciseNameCuration.js";
import { CHEST_EXERCISE_NAME_CORRECTIONS } from "../src/utils/chestExerciseNames.js";
import { BACK_EXERCISE_NAME_CORRECTIONS } from "../src/utils/backExerciseNames.js";
import { SHOULDER_EXERCISE_NAME_CORRECTIONS } from "../src/utils/shoulderExerciseNames.js";
import { naturalizeExerciseNameFully } from "../src/utils/naturalizeExerciseName.js";

const apply = process.argv.includes("--apply");
const chestOnly = process.argv.includes("--chest");
const backOnly = process.argv.includes("--back");
const shoulderOnly = process.argv.includes("--shoulders");
const naturalizeOnly = process.argv.includes("--naturalize");

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    if ([chestOnly, backOnly, shoulderOnly].filter(Boolean).length > 1) throw new Error("Elige solo un grupo muscular");
    if (naturalizeOnly && [chestOnly, backOnly, shoulderOnly].some(Boolean)) throw new Error("--naturalize no admite otro grupo");
    const naturalizedExercises = naturalizeOnly
      ? await Exercise.find({ type: "system", isActive: true }, "_id localizedNames aliases primaryMuscleGroup").lean()
      : [];
    const naturalizedCorrections = Object.fromEntries(naturalizedExercises.flatMap((exercise) => {
      if (EXERCISE_NAME_CORRECTIONS[exercise._id]) return [];
      const from = exercise.localizedNames?.es;
      const es = naturalizeExerciseNameFully(from, { group: exercise.primaryMuscleGroup, id: exercise._id });
      return from && es !== from ? [[exercise._id, { from, es }]] : [];
    }));
    const corrections = naturalizeOnly ? naturalizedCorrections : chestOnly ? CHEST_EXERCISE_NAME_CORRECTIONS
      : backOnly ? BACK_EXERCISE_NAME_CORRECTIONS
        : shoulderOnly ? SHOULDER_EXERCISE_NAME_CORRECTIONS : EXERCISE_NAME_CORRECTIONS;
    const ids = Object.keys(corrections);
    const exercises = await Exercise.find(
      { _id: { $in: ids }, type: "system" },
      "_id localizedNames aliases type",
    ).lean();
    const byId = new Map(exercises.map((exercise) => [exercise._id, exercise]));
    const missing = ids.filter((id) => !byId.has(id));
    const reviewed = ids.map((id) => {
      const exercise = byId.get(id);
      return exercise ? { id, ...getCuratedExerciseNamePatch(exercise, corrections) } : null;
    }).filter(Boolean);
    const conflicts = reviewed.filter((item) => item.status === "conflict");
    const changes = reviewed.filter((item) => item.status === "change");
    console.log(JSON.stringify({
      mode: apply ? "apply" : "preview",
      group: naturalizeOnly ? "naturalize" : chestOnly ? "chest" : backOnly ? "back" : shoulderOnly ? "shoulders" : "all",
      total: ids.length,
      missing,
      conflicts,
      current: reviewed.filter((item) => item.status === "current").length,
      changes: changes.map(({ id, before, after }) => ({ id, before, after })),
    }, null, 2));

    if (missing.length || conflicts.length) {
      throw new Error("El catálogo cambió; revisa los registros antes de aplicar correcciones.");
    }
    if (!apply) return;

    if (changes.length) {
      const operations = changes.map(({ id, values, before }) => ({
        updateOne: {
          filter: { _id: id, "localizedNames.es": before },
          update: { $set: values },
        },
      }));
      const result = await Exercise.bulkWrite(operations, { ordered: true });
      if (result.matchedCount !== changes.length) {
        throw new Error(`Solo coincidieron ${result.matchedCount} de ${changes.length} ejercicios.`);
      }
      console.log(JSON.stringify({ matched: result.matchedCount, modified: result.modifiedCount }));
    }

    const renamed = Object.entries(corrections).flatMap(([id, { from, es, previousNames = [] }]) =>
      [from, ...previousNames].filter((name) => name !== es).map((name) => [id, { from: name, es }]));
    const routineOperations = renamed.flatMap(([id, { from, es }]) => [
      {
        updateMany: {
          filter: { exercises: { $elemMatch: { exerciseId: id, name: from } } },
          update: { $set: { "exercises.$[item].name": es } },
          arrayFilters: [{ "item.exerciseId": id, "item.name": from }],
        },
      },
      {
        updateMany: {
          filter: { "exercises.alternatives": { $elemMatch: { exerciseId: id, name: from } } },
          update: { $set: { "exercises.$[].alternatives.$[item].name": es } },
          arrayFilters: [{ "item.exerciseId": id, "item.name": from }],
        },
      },
    ]);
    const trainingOperations = renamed.map(([id, { from, es }]) => ({
      updateMany: {
        filter: { exercises: { $elemMatch: { exerciseId: id, exerciseName: from } } },
        update: { $set: { "exercises.$[item].exerciseName": es } },
        arrayFilters: [{ "item.exerciseId": id, "item.exerciseName": from }],
      },
    }));
    const sessionOperations = renamed.map(([id, { from, es }]) => ({
      updateMany: {
        filter: { exerciseId: id, exerciseName: from },
        update: { $set: { exerciseName: es } },
      },
    }));
    const routines = routineOperations.length ? await Routine.bulkWrite(routineOperations, { ordered: true }) : null;
    const trainings = trainingOperations.length ? await Training.bulkWrite(trainingOperations, { ordered: true }) : null;
    const sessions = sessionOperations.length ? await Session.bulkWrite(sessionOperations, { ordered: true }) : null;
    console.log(JSON.stringify({ snapshotsUpdated: {
      routines: routines?.modifiedCount || 0,
      trainings: trainings?.modifiedCount || 0,
      sessions: sessions?.modifiedCount || 0,
    } }));
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
