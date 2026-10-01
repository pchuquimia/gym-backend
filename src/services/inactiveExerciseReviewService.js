import CatalogSwitchState from "../models/CatalogSwitchState.js";
import Exercise from "../models/Exercise.js";
import ExerciseMigration from "../models/ExerciseMigration.js";
import { getExerciseReferenceCounts } from "./exerciseMigrationService.js";

export const inactiveExerciseReason = (exercise) => {
  if (exercise.mergedIntoExerciseId) return "merged";
  if (!exercise.source?.provider) return "previous_catalog";
  return exercise.classificationStatus === "review" ? "review" : "inactive";
};

export const listInactiveExercisesForReview = async () => {
  const exercises = await Exercise.find({ type: "system", isActive: false })
    .select("_id name localizedNames aliases muscle primaryMuscleGroup equipment image media.image source.provider classificationStatus mergedIntoExerciseId")
    .sort({ name: 1 })
    .lean();
  const result = [];
  for (let index = 0; index < exercises.length; index += 12) {
    const batch = exercises.slice(index, index + 12);
    const rows = await Promise.all(batch.map(async (exercise) => ({
      id: exercise._id,
      name: exercise.localizedNames?.es || exercise.name,
      nameEnglish: exercise.localizedNames?.en || "",
      muscle: exercise.primaryMuscleGroup || exercise.muscle || "",
      equipment: exercise.equipment || [],
      image: exercise.media?.image?.url || exercise.image || "",
      source: exercise.source?.provider || "previous_catalog",
      reason: inactiveExerciseReason(exercise),
      mergedIntoExerciseId: exercise.mergedIntoExerciseId || "",
      references: await getExerciseReferenceCounts(exercise._id),
    })));
    result.push(...rows);
  }
  return result;
};

export const restoreInactiveExercise = async ({ exerciseId, performedBy }) => {
  const exercise = await Exercise.findById(exerciseId);
  if (!exercise || exercise.type !== "system" || exercise.isActive !== false) {
    const error = new Error("El ejercicio desactivado no existe");
    error.statusCode = 404;
    throw error;
  }
  if (exercise.mergedIntoExerciseId) {
    const error = new Error("Esta ficha ya fue fusionada. Conserva la ficha de destino o revisa la migración.");
    error.statusCode = 409;
    throw error;
  }
  exercise.isActive = true;
  exercise.updatedBy = performedBy;
  await exercise.save();
  return { ok: true, id: exerciseId };
};

export const permanentlyDeleteInactiveExercise = async ({ exerciseId, performedBy }) => {
  const exercise = await Exercise.findById(exerciseId).lean();
  if (!exercise || exercise.type !== "system" || exercise.isActive !== false) {
    const error = new Error("El ejercicio desactivado no existe");
    error.statusCode = 404;
    throw error;
  }
  const references = await getExerciseReferenceCounts(exerciseId);
  if (references.total > 0) {
    const error = new Error("El ejercicio tiene rutinas o entrenamientos asociados. Migra esas referencias antes de eliminarlo.");
    error.statusCode = 409;
    error.details = references;
    throw error;
  }
  if (await Exercise.exists({ mergedIntoExerciseId: exerciseId })) {
    const error = new Error("Otra ficha está fusionada con este ejercicio.");
    error.statusCode = 409;
    throw error;
  }
  const deletion = await Exercise.deleteOne({ _id: exerciseId, isActive: false });
  if (!deletion.deletedCount) {
    const error = new Error("La ficha cambió durante la revisión. Actualiza la lista antes de intentar otra vez.");
    error.statusCode = 409;
    throw error;
  }
  await Promise.all([
    Exercise.updateMany(
      { "alternateMedia.sourceExerciseId": exerciseId },
      { $pull: { alternateMedia: { sourceExerciseId: exerciseId } } },
    ),
    CatalogSwitchState.updateMany(
      { "previousExercises.exerciseId": exerciseId },
      { $pull: { previousExercises: { exerciseId } } },
    ),
    ExerciseMigration.create({
      operation: "delete",
      sourceExercise: { id: exerciseId, name: exercise.localizedNames?.es || exercise.name },
      targetExercise: { id: "", name: "" },
      references,
      sourceDeleted: true,
      performedBy,
    }),
  ]);
  return { ok: true, id: exerciseId, references };
};
