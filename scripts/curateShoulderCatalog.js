import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import { getExerciseReferenceCounts, mergeExercises } from "../src/services/exerciseMigrationService.js";
import {
  SHOULDER_DUPLICATE_MERGES,
  SHOULDER_EXERCISES_TO_HIDE,
  SHOULDER_EXERCISE_METADATA,
  buildShoulderMetadataPatch,
} from "../src/utils/shoulderCatalogCuration.js";

const apply = process.argv.includes("--apply");
const curator = "catalog-curation";

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    const ids = [...new Set([...SHOULDER_DUPLICATE_MERGES.flat(),
      ...Object.keys(SHOULDER_EXERCISES_TO_HIDE), ...Object.keys(SHOULDER_EXERCISE_METADATA)])];
    const rows = await Exercise.find({ _id: { $in: ids }, type: "system" },
      "_id isActive mergedIntoExerciseId primaryMuscleGroup").lean();
    const byId = new Map(rows.map((row) => [row._id, row]));
    if (ids.some((id) => !byId.has(id))) throw new Error("Faltan fichas de hombros");

    const merges = [];
    for (const [sourceId, targetId] of SHOULDER_DUPLICATE_MERGES) {
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!target.isActive || target.primaryMuscleGroup !== "Hombros") throw new Error(`Destino alterado: ${targetId}`);
      if (!source.isActive && source.mergedIntoExerciseId === targetId) {
        merges.push({ sourceId, targetId, status: "current" });
      } else {
        if (!source.isActive || source.primaryMuscleGroup !== "Hombros") throw new Error(`Origen alterado: ${sourceId}`);
        merges.push({ sourceId, targetId, status: "pending", references: (await getExerciseReferenceCounts(sourceId)).total });
      }
    }
    const hide = [];
    for (const [id, reason] of Object.entries(SHOULDER_EXERCISES_TO_HIDE)) {
      const row = byId.get(id);
      if (row.primaryMuscleGroup !== "Hombros") throw new Error(`Grupo alterado: ${id}`);
      const references = (await getExerciseReferenceCounts(id)).total;
      if (references) throw new Error(`La ficha ${id} tiene ${references} referencias`);
      hide.push({ id, status: row.isActive ? "pending" : "current", reason });
    }
    for (const [id, meta] of Object.entries(SHOULDER_EXERCISE_METADATA)) {
      const group = byId.get(id).primaryMuscleGroup;
      if (group !== "Hombros" && group !== meta.group) throw new Error(`Clasificación alterada: ${id}`);
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", merges, hide,
      metadata: SHOULDER_EXERCISE_METADATA }, null, 2));
    if (!apply) return;

    for (const item of merges.filter((entry) => entry.status === "pending")) {
      await mergeExercises({ sourceExerciseId: item.sourceId, targetExerciseId: item.targetId, performedBy: curator });
      if ((await getExerciseReferenceCounts(item.sourceId)).total) throw new Error(`Quedan referencias en ${item.sourceId}`);
      await Exercise.updateOne({ _id: item.sourceId, isActive: true }, {
        $set: { isActive: false, mergedIntoExerciseId: item.targetId, classificationStatus: "reviewed", updatedBy: curator },
      });
      console.log(`Consolidado ${item.sourceId} -> ${item.targetId}`);
    }
    for (const item of hide.filter((entry) => entry.status === "pending")) {
      await Exercise.updateOne({ _id: item.id, primaryMuscleGroup: "Hombros", isActive: true }, {
        $set: { isActive: false, classificationStatus: "review", updatedBy: curator },
      });
    }
    for (const [id, meta] of Object.entries(SHOULDER_EXERCISE_METADATA)) {
      await Exercise.updateOne({ _id: id }, {
        $set: { ...buildShoulderMetadataPatch(meta), classificationStatus: "reviewed", updatedBy: curator },
      });
    }
    console.log("Catálogo de hombros actualizado.");
  } finally { await mongoose.disconnect(); }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
