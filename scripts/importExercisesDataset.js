import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import CatalogSwitchState from "../src/models/CatalogSwitchState.js";
import ExerciseMigration from "../src/models/ExerciseMigration.js";
import { inferWeightConfig } from "../src/utils/weightConfig.js";
import { EXERCISE_NAME_CORRECTIONS, getCuratedExerciseNamePatch } from "../src/utils/exerciseNameCuration.js";
import { naturalizeExerciseNameFully } from "../src/utils/naturalizeExerciseName.js";
import { CHEST_EXERCISE_METADATA, CHEST_DESCRIPTION_FIXES, buildChestMetadataPatch } from "../src/utils/chestCatalogCuration.js";
import { BACK_EXERCISE_METADATA, buildBackMetadataPatch } from "../src/utils/backCatalogCuration.js";
import { SHOULDER_EXERCISE_METADATA, buildShoulderMetadataPatch } from "../src/utils/shoulderCatalogCuration.js";
import {
  DATASET_COMMIT,
  DATASET_PROVIDER,
  fetchDataset,
  summarizeDataset,
  toDatasetExercise,
} from "./exerciseDatasetConfig.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const switchCatalog = args.has("--switch");
const restorePrevious = args.has("--restore-previous");
const switchKey = `dataset-${DATASET_PROVIDER}-${DATASET_COMMIT.slice(0, 12)}`;

const connect = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta definido");
  await mongoose.connect(process.env.MONGO_URI);
};

const restoreCatalog = async () => {
  await connect();
  const state = await CatalogSwitchState.findOne({
    sourceProvider: DATASET_PROVIDER,
    status: "active",
  }).sort({ activatedAt: -1 });
  if (!state) throw new Error("No active catalog switch was found");

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "restore-preview",
          switchKey: state.key,
          previousExercises: state.previousExercises.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const operations = state.previousExercises.map((item) => ({
    updateOne: {
      filter: { _id: item.exerciseId },
      update: { $set: { isActive: item.isActive } },
    },
  }));
  if (operations.length) {
    await Exercise.bulkWrite(operations, { ordered: false });
  }
  await Exercise.updateMany(
    { type: "system", "source.provider": DATASET_PROVIDER },
    { $set: { isActive: false } },
  );
  state.status = "restored";
  state.restoredAt = new Date();
  await state.save();
  console.log(`Catalog restored from ${state.key}`);
};

const activateDatasetCatalog = async () => {
  const activeState = await CatalogSwitchState.findOne({
    sourceProvider: DATASET_PROVIDER,
    status: "active",
  });
  if (activeState) {
    console.log(`Catalog switch ${activeState.key} is already active; keeping review decisions`);
    return;
  }

  const previous = await Exercise.find(
    { type: "system", "source.provider": { $ne: DATASET_PROVIDER } },
    "_id isActive",
  ).lean();
  await CatalogSwitchState.create({
    key: switchKey,
    sourceProvider: DATASET_PROVIDER,
    previousExercises: previous.map((exercise) => ({
      exerciseId: exercise._id,
      isActive: exercise.isActive !== false,
    })),
  });
  await Exercise.updateMany(
    { type: "system", "source.provider": { $ne: DATASET_PROVIDER } },
    { $set: { isActive: false } },
  );
  await Exercise.updateMany(
    { type: "system", "source.provider": DATASET_PROVIDER },
    { $set: { isActive: true } },
  );
  console.log(
    `Dataset catalog activated; ${previous.length} previous system exercises were hidden`,
  );
};

const importDataset = async () => {
  const rows = await fetchDataset();
  const now = new Date();
  const exercises = rows
    .map((row) => toDatasetExercise(row, now))
    .filter((exercise) => exercise._id && exercise.name);
  const summary = summarizeDataset(exercises);

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          datasetCommit: DATASET_COMMIT,
          switchCatalog,
          ...summary,
          sample: exercises.slice(0, 5).map((exercise) => ({
            id: exercise._id,
            name: exercise.name,
            bodyRegion: exercise.bodyRegion,
            primaryMuscleGroup: exercise.primaryMuscleGroup,
            equipment: exercise.equipment,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  await connect();
  const existingExercises = await Exercise.find(
    { "source.provider": DATASET_PROVIDER },
    "source.externalId aliases classificationStatus",
  ).lean();
  const existingByExternalId = new Map(
    existingExercises.map((exercise) => [exercise.source?.externalId, exercise]),
  );
  const deletedRecords = await ExerciseMigration.find(
    {
      operation: "delete",
      sourceDeleted: true,
      "sourceExercise.id": { $in: exercises.map((exercise) => exercise._id) },
    },
    "sourceExercise.id",
  ).lean();
  const permanentlyDeletedIds = new Set(
    deletedRecords.map((record) => record.sourceExercise?.id).filter(Boolean),
  );
  const operations = exercises.filter((exercise) => !permanentlyDeletedIds.has(exercise._id)).map((exercise) => {
    const { _id, createdBy, isActive, ...set } = exercise;
    const previous = existingByExternalId.get(exercise.source.externalId);
    set.aliases = [...new Set([...(previous?.aliases || []), ...(set.aliases || [])])];
    if (EXERCISE_NAME_CORRECTIONS[_id]) {
      const curated = getCuratedExerciseNamePatch({ _id, localizedNames: set.localizedNames, aliases: set.aliases });
      if (curated?.status === "conflict") throw new Error(`Cambió el nombre de origen: ${_id}`);
      if (curated?.values) {
        set.localizedNames = {
          ...set.localizedNames,
          es: curated.values["localizedNames.es"],
          ...(curated.values["localizedNames.en"] ? { en: curated.values["localizedNames.en"] } : {}),
        };
        set.aliases = curated.values.aliases;
      }
    } else if (set.localizedNames?.es) {
      const originalSpanishName = set.localizedNames.es;
      const naturalSpanishName = naturalizeExerciseNameFully(originalSpanishName, {
        group: set.primaryMuscleGroup,
        id: _id,
      });
      if (naturalSpanishName !== originalSpanishName) {
        set.localizedNames = { ...set.localizedNames, es: naturalSpanishName };
        set.aliases = [...new Set([...set.aliases, originalSpanishName])];
      }
    }
    if (CHEST_EXERCISE_METADATA[_id]) Object.assign(set, buildChestMetadataPatch(CHEST_EXERCISE_METADATA[_id]));
    if (BACK_EXERCISE_METADATA[_id]) Object.assign(set, buildBackMetadataPatch(BACK_EXERCISE_METADATA[_id]));
    if (SHOULDER_EXERCISE_METADATA[_id]) Object.assign(set, buildShoulderMetadataPatch(SHOULDER_EXERCISE_METADATA[_id]));
    if (CHEST_DESCRIPTION_FIXES[_id]) {
      set.instructions = CHEST_DESCRIPTION_FIXES[_id];
      set.description = set.instructions.join(" ");
    }
    if (previous?.classificationStatus === "review" || previous?.classificationStatus === "reviewed") {
      set.classificationStatus = previous.classificationStatus;
    }
    set.weightConfig = inferWeightConfig(exercise);
    return {
      updateOne: {
        filter: {
          "source.provider": DATASET_PROVIDER,
          "source.externalId": exercise.source.externalId,
        },
        update: {
          $set: set,
          $setOnInsert: { _id, createdBy, isActive },
        },
        upsert: true,
      },
    };
  });
  const result = await Exercise.bulkWrite(operations, { ordered: false });
  if (switchCatalog) await activateDatasetCatalog();

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        datasetCommit: DATASET_COMMIT,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        inserted: result.upsertedCount,
        skippedPermanentlyDeleted: permanentlyDeletedIds.size,
        ...summary,
      },
      null,
      2,
    ),
  );
};

try {
  if (restorePrevious) await restoreCatalog();
  else await importDataset();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
