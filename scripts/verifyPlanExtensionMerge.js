import "dotenv/config";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import { getMongoConnectionOptions } from "../src/config/db.js";
import {
  buildPlanExtensionMerges,
  remapPlanReferences,
} from "../src/utils/planExtensionMerge.js";

const { EJSON } = mongoose.mongo.BSON;
const same = (left, right) =>
  EJSON.stringify(left, { relaxed: false }) ===
  EJSON.stringify(right, { relaxed: false });
try {
  if (!process.argv[2])
    throw new Error("Indica el archivo de respaldo de la fusión");
  const backup = EJSON.parse(await fs.readFile(process.argv[2], "utf8"));
  await mongoose.connect(process.env.MONGO_URI, {
    ...getMongoConnectionOptions(),
    autoIndex: false,
    autoCreate: false,
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== backup.database)
    throw new Error("El respaldo pertenece a otra base de datos");
  const merges = buildPlanExtensionMerges(backup.documents.trainingplans);
  const aliases = new Map(
    merges.flatMap((merge) =>
      merge.removedIds.map((oldId) => [oldId, merge.canonicalId]),
    ),
  );
  const trainings = await db
    .collection("trainings")
    .find({ _id: { $in: backup.documents.trainings.map((item) => item._id) } })
    .toArray();
  if (trainings.length !== backup.documents.trainings.length)
    throw new Error("Faltan entrenamientos del respaldo");
  for (const original of backup.documents.trainings) {
    const saved = trainings.find(
      (item) => String(item._id) === String(original._id),
    );
    const expected = remapPlanReferences(original, aliases);
    expected.updatedAt = saved.updatedAt;
    if (!same(expected, saved))
      throw new Error(`Cambió el contenido del entrenamiento ${original._id}`);
  }
  const routines = await db
    .collection("routines")
    .find({ _id: { $in: backup.documents.routines.map((item) => item._id) } })
    .toArray();
  if (routines.length !== backup.documents.routines.length)
    throw new Error("Faltan rutinas del respaldo");
  for (const original of backup.documents.routines) {
    const saved = routines.find(
      (item) => String(item._id) === String(original._id),
    );
    if (
      !same(original.exercises, saved.exercises) ||
      original.progressScopeId !== saved.progressScopeId
    )
      throw new Error(
        `Cambió el progreso o los ejercicios de la rutina ${original._id}`,
      );
  }
  for (const merge of merges) {
    const plan = await db
      .collection("trainingplans")
      .findOne({ _id: new mongoose.Types.ObjectId(merge.canonicalId) });
    if (
      !plan ||
      !same(plan.startDate, merge.updates.startDate) ||
      !same(plan.endDate, merge.updates.endDate) ||
      plan.name !== merge.updates.name ||
      plan.durationWeeks !== merge.updates.durationWeeks ||
      plan.status !== merge.chain.at(-1).status
    )
      throw new Error(
        "La planificación fusionada no coincide con el resultado esperado",
      );
    if (
      await db
        .collection("trainingplans")
        .countDocuments({
          _id: {
            $in: merge.removedIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
    )
      throw new Error("Quedaron planificaciones duplicadas");
    const current = routines.filter(
      (routine) => routine.trainingPlanId === merge.canonicalId,
    );
    if (
      current.length !== merge.currentRoutineIds.length ||
      current.some(
        (routine) =>
          !merge.currentRoutineIds.includes(String(routine._id)) ||
          (plan.status === "active" &&
            (!routine.isAvailableForTraining || routine.isArchived)),
      )
    )
      throw new Error(
        "La disponibilidad de las rutinas actuales no es correcta",
      );
    console.log(
      JSON.stringify(
        {
          name: plan.name,
          status: plan.status,
          startDate: plan.startDate,
          endDate: plan.endDate,
          durationWeeks: plan.durationWeeks,
          currentRoutines: current.length,
          historicalRoutines: routines.filter(
            (routine) => routine.historicalTrainingPlanId === merge.canonicalId,
          ).length,
          trainingsVerified: trainings.filter(
            (training) => training.trainingPlanId === merge.canonicalId,
          ).length,
          trainingContentUnchanged: true,
          routineExercisesAndProgressUnchanged: true,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(
    "Verificación fallida:",
    error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, "[conexión]"),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
