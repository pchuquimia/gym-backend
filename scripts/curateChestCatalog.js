import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import {
  getExerciseReferenceCounts,
  mergeExercises,
} from "../src/services/exerciseMigrationService.js";
import {
  CHEST_DUPLICATE_MERGES,
  CHEST_EXERCISES_TO_HIDE,
  CHEST_EXERCISE_METADATA,
  CHEST_DESCRIPTION_FIXES,
  buildChestMetadataPatch,
} from "../src/utils/chestCatalogCuration.js";

const apply = process.argv.includes("--apply");
const curator = "catalog-curation";

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const merges = [];
    for (const [sourceId, targetId] of CHEST_DUPLICATE_MERGES) {
      const [source, target] = await Promise.all([
        Exercise.findById(sourceId, "_id isActive mergedIntoExerciseId primaryMuscleGroup localizedNames").lean(),
        Exercise.findById(targetId, "_id isActive primaryMuscleGroup localizedNames").lean(),
      ]);
      if (!source || !target || target.isActive === false) throw new Error(`Falta el par ${sourceId} -> ${targetId}`);
      if (source.isActive === false && source.mergedIntoExerciseId === targetId) {
        merges.push({ sourceId, targetId, status: "current" });
        continue;
      }
      if (source.isActive === false || source.primaryMuscleGroup !== "Pecho" || target.primaryMuscleGroup !== "Pecho") {
        throw new Error(`Par alterado: ${sourceId} -> ${targetId}`);
      }
      const references = await getExerciseReferenceCounts(sourceId);
      merges.push({ sourceId, targetId, status: "pending", references: references.total });
    }

    const hide = Object.entries(CHEST_EXERCISES_TO_HIDE);
    const metadata = Object.entries(CHEST_EXERCISE_METADATA);
    const descriptions = Object.entries(CHEST_DESCRIPTION_FIXES);
    const ids = [...new Set([...hide.map(([id]) => id), ...metadata.map(([id]) => id), ...descriptions.map(([id]) => id)])];
    const rows = await Exercise.find({ _id: { $in: ids }, type: "system" },
      "_id isActive primaryMuscleGroup description instructions equipment category").lean();
    const byId = new Map(rows.map((row) => [row._id, row]));
    if (ids.some((id) => !byId.has(id))) throw new Error("Faltan fichas del catálogo");
    for (const id of ids) {
      const row = byId.get(id);
      if (row.primaryMuscleGroup !== "Pecho" && CHEST_EXERCISE_METADATA[id]?.group !== row.primaryMuscleGroup) {
        throw new Error(`Clasificación cambiada: ${id}`);
      }
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", merges, hide,
      metadata: metadata.map(([id, meta]) => ({ id, ...meta })),
      descriptions: descriptions.map(([id]) => id) }, null, 2));
    if (!apply) return;

    for (const merge of merges.filter((item) => item.status === "pending")) {
      await mergeExercises({ sourceExerciseId: merge.sourceId, targetExerciseId: merge.targetId, performedBy: curator });
      const remaining = await getExerciseReferenceCounts(merge.sourceId);
      if (remaining.total) throw new Error(`Aún quedan referencias en ${merge.sourceId}`);
      await Exercise.updateOne({ _id: merge.sourceId, isActive: true }, {
        $set: { isActive: false, mergedIntoExerciseId: merge.targetId, classificationStatus: "reviewed", updatedBy: curator },
      });
      console.log(`Consolidado ${merge.sourceId} -> ${merge.targetId}`);
    }
    for (const [id] of hide) {
      await Exercise.updateOne({ _id: id, primaryMuscleGroup: "Pecho" }, {
        $set: { isActive: false, classificationStatus: "review", updatedBy: curator },
      });
    }
    for (const [id, meta] of metadata) {
      await Exercise.updateOne({ _id: id }, {
        $set: { ...buildChestMetadataPatch(meta), classificationStatus: "reviewed", updatedBy: curator },
      });
    }
    for (const [id, instructions] of descriptions) {
      await Exercise.updateOne({ _id: id }, {
        $set: { instructions, description: instructions.join(" "), classificationStatus: "reviewed", updatedBy: curator },
      });
    }
    console.log("Curación de fichas aplicada.");
  } finally { await mongoose.disconnect(); }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
