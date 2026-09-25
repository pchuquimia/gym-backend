import "dotenv/config";
import mongoose from "mongoose";
import CatalogSwitchState from "../src/models/CatalogSwitchState.js";
import CodexImageRequest from "../src/models/CodexImageRequest.js";
import Exercise from "../src/models/Exercise.js";
import Routine from "../src/models/Routine.js";
import RoutineAuditLog from "../src/models/RoutineAuditLog.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import TrainingDraft from "../src/models/TrainingDraft.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const auditAll = args.has("--audit-all");
const providerArgument = process.argv.find((argument) =>
  argument.startsWith("--provider="),
);
const createdByArgument = process.argv.find((argument) =>
  argument.startsWith("--created-by="),
);
const provider =
  providerArgument?.split("=").slice(1).join("=").trim() || "hasaneyldrm";
const createdBy = providerArgument
  ? ""
  : createdByArgument?.split("=").slice(1).join("=").trim() || "excel_import";

const mediaFields = [
  "image",
  "imagePublicId",
  "thumb",
  "media.image.url",
  "media.image.publicId",
  "media.thumbnail.url",
  "media.thumbnail.publicId",
  "media.animation.url",
  "media.animation.publicId",
  "media.video.url",
  "media.video.publicId",
];

const emptyField = (field) => ({
  $or: [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: "" },
  ],
});

const candidateFilter = {
  type: "system",
  ...(auditAll
    ? {}
    : createdBy
      ? { createdBy }
      : { "source.provider": provider }),
  $and: mediaFields.map(emptyField),
};

const referencePaths = [
  [Routine, "exercises.exerciseId", "routines"],
  [Routine, "exercises.alternatives.exerciseId", "routineAlternatives"],
  [Training, "exercises.exerciseId", "trainings"],
  [Training, "timeEvents.exerciseId", "trainingTimeEvents"],
  [Training, "exerciseDurations.exerciseId", "trainingDurations"],
  [Session, "exerciseId", "sessions"],
  [CodexImageRequest, "exerciseId", "imageRequests"],
  [Exercise, "alternateMedia.sourceExerciseId", "alternateMedia"],
  [Exercise, "mergedIntoExerciseId", "mergedExercises"],
  [TrainingDraft, "snapshot.exercises.id", "trainingDrafts"],
  [TrainingDraft, "snapshot.exercises.exerciseId", "trainingDrafts"],
  [TrainingDraft, "snapshot.timeEvents.exerciseId", "trainingDrafts"],
  [TrainingDraft, "snapshot.exerciseDurations.exerciseId", "trainingDrafts"],
  [RoutineAuditLog, "snapshot.exercises.exerciseId", "routineAuditLogs"],
  [
    RoutineAuditLog,
    "snapshot.exercises.alternatives.exerciseId",
    "routineAuditLogs",
  ],
];

const connect = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta definido");
  await mongoose.connect(process.env.MONGO_URI);
};

const findReferences = async (candidateIds) => {
  const references = new Map();
  await Promise.all(
    referencePaths.map(async ([Model, path, source]) => {
      const ids = await Model.distinct(path, { [path]: { $in: candidateIds } });
      ids.forEach((id) => {
        const key = String(id || "");
        if (!key) return;
        const sources = references.get(key) || new Set();
        sources.add(source);
        references.set(key, sources);
      });
    }),
  );
  return references;
};

const run = async () => {
  await connect();
  const candidates = await Exercise.find(
    candidateFilter,
    "_id name isActive source.provider createdBy classificationStatus createdAt",
  )
    .sort({ _id: 1 })
    .lean();
  const candidateIds = candidates.map((exercise) => String(exercise._id));
  const references = await findReferences(candidateIds);
  const blocked = candidates.filter((exercise) =>
    references.has(String(exercise._id)),
  );
  const removable = candidates.filter(
    (exercise) => !references.has(String(exercise._id)),
  );
  const removableIds = removable.map((exercise) => String(exercise._id));

  const summary = {
    mode: apply ? "apply" : "preview",
    origin: auditAll
      ? "all"
      : createdBy
        ? { createdBy }
        : { provider },
    importedWithoutMedia: candidates.length,
    origins: candidates.reduce((counts, exercise) => {
      const origin =
        exercise.source?.provider || exercise.createdBy || "without-marker";
      counts[origin] = (counts[origin] || 0) + 1;
      return counts;
    }, {}),
    protectedByReferences: blocked.length,
    removable: removable.length,
    protectedSample: blocked.slice(0, 20).map((exercise) => ({
      id: exercise._id,
      name: exercise.name,
      references: [...(references.get(String(exercise._id)) || [])],
    })),
    removableSample: removable.slice(0, 20).map((exercise) => ({
      id: exercise._id,
      name: exercise.name,
      active: exercise.isActive !== false,
      provider: exercise.source?.provider || "",
      createdBy: exercise.createdBy || "",
      classificationStatus: exercise.classificationStatus || "",
    })),
  };

  if (apply && auditAll) {
    throw new Error("--audit-all solo esta disponible en modo preview");
  }

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!removableIds.length) {
    console.log(JSON.stringify({ ...summary, deleted: 0, remaining: 0 }, null, 2));
    return;
  }

  const result = await Exercise.deleteMany({
    ...candidateFilter,
    _id: { $in: removableIds },
  });
  await CatalogSwitchState.updateMany(
    { "previousExercises.exerciseId": { $in: removableIds } },
    { $pull: { previousExercises: { exerciseId: { $in: removableIds } } } },
  );
  const remaining = await Exercise.countDocuments({
    ...candidateFilter,
    _id: { $in: removableIds },
  });
  console.log(
    JSON.stringify(
      { ...summary, deleted: result.deletedCount, remaining },
      null,
      2,
    ),
  );
};

try {
  await run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
