import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import { getExerciseReferenceCounts, mergeExercises } from "../src/services/exerciseMigrationService.js";
import {
  BACK_DUPLICATE_MERGES,
  BACK_EXERCISES_TO_HIDE,
  BACK_EXERCISE_METADATA,
  buildBackMetadataPatch,
} from "../src/utils/backCatalogCuration.js";

const apply = process.argv.includes("--apply");
const curator = "catalog-curation";

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    const ids = [...new Set([
      ...BACK_DUPLICATE_MERGES.flat(),
      ...Object.keys(BACK_EXERCISES_TO_HIDE),
      ...Object.keys(BACK_EXERCISE_METADATA),
    ])];
    const rows = await Exercise.find({ _id: { $in: ids }, type: "system" },
      "_id isActive mergedIntoExerciseId primaryMuscleGroup").lean();
    const byId = new Map(rows.map((row) => [row._id, row]));
    if (ids.some((id) => !byId.has(id))) throw new Error("Faltan fichas del catálogo de espalda");

    const merges = [];
    for (const [sourceId, targetId] of BACK_DUPLICATE_MERGES) {
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!target.isActive || target.primaryMuscleGroup !== "Espalda") throw new Error(`Destino alterado: ${targetId}`);
      if (!source.isActive && source.mergedIntoExerciseId === targetId) {
        merges.push({ sourceId, targetId, status: "current" });
      } else {
        if (!source.isActive || source.primaryMuscleGroup !== "Espalda") throw new Error(`Origen alterado: ${sourceId}`);
        merges.push({ sourceId, targetId, status: "pending", references: (await getExerciseReferenceCounts(sourceId)).total });
      }
    }
    const hide = [];
    for (const [id, reason] of Object.entries(BACK_EXERCISES_TO_HIDE)) {
      const row = byId.get(id);
      if (row.primaryMuscleGroup !== "Espalda") throw new Error(`Grupo alterado: ${id}`);
      const references = (await getExerciseReferenceCounts(id)).total;
      if (references) throw new Error(`La ficha ${id} aún tiene ${references} referencias; requiere migración`);
      hide.push({ id, status: row.isActive ? "pending" : "current", reason });
    }
    for (const [id, meta] of Object.entries(BACK_EXERCISE_METADATA)) {
      const group = byId.get(id).primaryMuscleGroup;
      if (group !== "Espalda" && group !== meta.group) throw new Error(`Clasificación alterada: ${id}`);
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", merges, hide,
      metadata: BACK_EXERCISE_METADATA }, null, 2));
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
      await Exercise.updateOne({ _id: item.id, primaryMuscleGroup: "Espalda", isActive: true }, {
        $set: { isActive: false, classificationStatus: "review", updatedBy: curator },
      });
    }
    for (const [id, meta] of Object.entries(BACK_EXERCISE_METADATA)) {
      await Exercise.updateOne({ _id: id }, {
        $set: { ...buildBackMetadataPatch(meta), classificationStatus: "reviewed", updatedBy: curator },
      });
    }
    console.log("Catálogo de espalda actualizado.");
  } finally { await mongoose.disconnect(); }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
