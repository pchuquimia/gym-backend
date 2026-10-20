import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { getMongoConnectionOptions } from "../src/config/db.js";
import {
  buildPlanExtensionMerges,
  remapPlanReferences,
} from "../src/utils/planExtensionMerge.js";

const apply = process.argv.includes("--apply");
const { EJSON } = mongoose.mongo.BSON;
const serialize = (value) => EJSON.stringify(value, { relaxed: false });
const equivalent = (left, right) => serialize(left) === serialize(right);

try {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI, {
    ...getMongoConnectionOptions(),
    autoIndex: false,
    autoCreate: false,
  });
  const db = mongoose.connection.db;
  const allPlans = await db.collection("trainingplans").find({}).toArray();
  const merges = buildPlanExtensionMerges(allPlans);
  const aliases = new Map(
    merges.flatMap((merge) =>
      merge.removedIds.map((oldId) => [oldId, merge.canonicalId]),
    ),
  );
  const ids = merges.flatMap((merge) =>
    merge.chain.map((plan) => String(plan._id)),
  );
  const owners = merges.map((merge) => merge.athleteId);
  const filters = {
    trainingplans: {
      $or: [
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { sourcePlanId: { $in: ids } },
      ],
    },
    trainings: {
      $or: [
        { trainingPlanId: { $in: ids } },
        { "historicalRefs.trainingPlanId": { $in: ids } },
      ],
    },
    routines: {
      $or: [
        { trainingPlanId: { $in: ids } },
        { historicalTrainingPlanId: { $in: ids } },
      ],
    },
    athleteassessments: { planId: { $in: ids } },
    athletemeasurements: { planId: { $in: ids } },
    trainingdrafts: { ownerId: { $in: owners } },
  };
  const documents = {};
  for (const [name, filter] of Object.entries(filters))
    documents[name] = ids.length
      ? await db.collection(name).find(filter).sort({ _id: 1 }).toArray()
      : [];
  const report = merges.map((merge) => ({
    name: merge.updates.name,
    canonicalId: merge.canonicalId,
    mergedPlans: merge.chain.length,
    startDate: merge.updates.startDate,
    endDate: merge.updates.endDate,
    durationWeeks: merge.updates.durationWeeks,
    trainings: documents.trainings.filter((training) =>
      merge.chain.some((plan) => String(plan._id) === training.trainingPlanId),
    ).length,
    currentRoutines: merge.currentRoutineIds.length,
  }));
  console.log(
    JSON.stringify(
      { mode: apply ? "apply" : "audit", merges: report },
      null,
      2,
    ),
  );
  if (apply && merges.length) {
    const backupDir = fileURLToPath(
      new URL("../../.local-backups/", import.meta.url),
    );
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `plan-extensions-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(
      backupPath,
      EJSON.stringify(
        { database: db.databaseName, createdAt: new Date(), report, documents },
        null,
        2,
        { relaxed: false },
      ),
      { flag: "wx" },
    );
    console.log(`Respaldo: ${backupPath}`);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          for (const [name, filter] of Object.entries(filters)) {
            const current = await db
              .collection(name)
              .find(filter, { session })
              .sort({ _id: 1 })
              .toArray();
            if (!equivalent(current, documents[name]))
              throw new Error(
                `Cambió ${name} después del respaldo; vuelve a ejecutar la auditoría`,
              );
          }
          for (const merge of merges) {
            const assessments = documents.athleteassessments.filter((item) =>
              merge.chain.some((plan) => String(plan._id) === item.planId),
            );
            const assessmentKeys = assessments.map(
              (item) => `${item.athleteId}:${item.type}`,
            );
            if (new Set(assessmentKeys).size !== assessmentKeys.length)
              throw new Error(
                "Hay evaluaciones finales duplicadas; requieren revisión antes de fusionar",
              );
            const currentRoutines = documents.routines.filter(
              (routine) =>
                merge.currentRoutineIds.includes(String(routine._id)) &&
                String(routine.ownerId) === merge.athleteId,
            );
            if (
              currentRoutines.length !== new Set(merge.currentRoutineIds).size
            )
              throw new Error("Faltan rutinas de la planificación actual");
            const historicalIds = new Set(
              documents.routines
                .filter(
                  (routine) =>
                    merge.chain.some(
                      (plan) => String(plan._id) === routine.trainingPlanId,
                    ) && !merge.currentRoutineIds.includes(String(routine._id)),
                )
                .map((routine) => String(routine._id)),
            );
            if (
              allPlans.some(
                (plan) =>
                  !merge.chain.some(
                    (item) => String(item._id) === String(plan._id),
                  ) &&
                  ["active", "scheduled"].includes(plan.status) &&
                  (plan.weeklySchedule || []).some((slot) =>
                    historicalIds.has(String(slot.routineId)),
                  ),
              )
            )
              throw new Error(
                "Hay rutinas históricas utilizadas por otra planificación abierta",
              );
          }
          const now = new Date();
          for (const [name, collectionDocuments] of Object.entries(documents)) {
            for (const document of collectionDocuments) {
              if (name === "trainingplans" && aliases.has(String(document._id)))
                continue;
              const updated = remapPlanReferences(document, aliases);
              const merge = merges.find(
                (item) =>
                  name === "trainingplans" &&
                  item.canonicalId === String(document._id),
              );
              if (merge) Object.assign(updated, merge.updates);
              if (name === "routines") {
                const ownerMerge = merges.find((item) =>
                  item.chain.some(
                    (plan) => String(plan._id) === document.trainingPlanId,
                  ),
                );
                if (ownerMerge) {
                  if (String(document.ownerId) !== ownerMerge.athleteId)
                    throw new Error("Una rutina pertenece a otro atleta");
                  if (
                    ownerMerge.currentRoutineIds.includes(String(document._id))
                  ) {
                    Object.assign(updated, {
                      trainingPlanId: ownerMerge.canonicalId,
                      historicalTrainingPlanId: null,
                      isArchived: ownerMerge.chain.at(-1).status !== "active",
                      isAvailableForTraining:
                        ownerMerge.chain.at(-1).status === "active",
                    });
                  } else {
                    Object.assign(updated, {
                      trainingPlanId: null,
                      historicalTrainingPlanId: ownerMerge.canonicalId,
                      isArchived: true,
                      isAvailableForTraining: false,
                      detachedAt: now,
                    });
                  }
                }
              }
              if (!equivalent(document, updated)) {
                updated.updatedAt = now;
                await db
                  .collection(name)
                  .replaceOne({ _id: document._id }, updated, { session });
              }
            }
          }
          await db
            .collection("trainingplans")
            .deleteMany(
              {
                _id: {
                  $in: [...aliases.keys()].map(
                    (id) => new mongoose.Types.ObjectId(id),
                  ),
                },
              },
              { session },
            );
          for (const [name, fields] of Object.entries({
            trainings: ["trainingPlanId", "historicalRefs.trainingPlanId"],
            routines: ["trainingPlanId", "historicalTrainingPlanId"],
            athleteassessments: ["planId"],
            athletemeasurements: ["planId"],
            trainingplans: ["sourcePlanId"],
          })) {
            if (
              await db
                .collection(name)
                .countDocuments(
                  {
                    $or: fields.map((field) => ({
                      [field]: { $in: [...aliases.keys()] },
                    })),
                  },
                  { session },
                )
            )
              throw new Error(`Quedaron referencias antiguas en ${name}`);
          }
          const currentTrainings = await db
            .collection("trainings")
            .find(filters.trainings, { session })
            .toArray();
          // Comprobar por ID, porque los filtros originales incluyen todos los IDs de destino.
          if (currentTrainings.length !== documents.trainings.length)
            throw new Error(
              "Cambió la cantidad de entrenamientos durante la fusión",
            );
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    console.log(
      "Fusión completada y referencias verificadas. No se eliminaron entrenamientos ni rutinas.",
    );
  }
} catch (error) {
  console.error(
    "No se pudo fusionar:",
    error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, "[conexión]"),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
