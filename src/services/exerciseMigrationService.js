import CatalogSwitchState from "../models/CatalogSwitchState.js";
import Exercise from "../models/Exercise.js";
import ExerciseMigration from "../models/ExerciseMigration.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";

export const DATASET_PROVIDER = "hasaneyldrm";

const idOf = (value) => String(value || "");
const sameId = (left, right) => idOf(left) === idOf(right);
const targetName = (exercise = {}) =>
  exercise.localizedNames?.es || exercise.name || "Ejercicio";
const targetMuscle = (exercise = {}) =>
  exercise.primaryMuscleGroup ||
  exercise.primaryMuscle ||
  exercise.muscle ||
  "";
const targetImage = (exercise = {}) =>
  exercise.media?.thumbnail?.url ||
  exercise.media?.image?.url ||
  exercise.thumb ||
  exercise.image ||
  "";
const targetImagePublicId = (exercise = {}) =>
  exercise.media?.thumbnail?.publicId ||
  exercise.media?.image?.publicId ||
  exercise.imagePublicId ||
  "";

const legacyCatalogFilter = {
  type: "system",
  "source.provider": { $ne: DATASET_PROVIDER },
};

const currentCatalogFilter = {
  type: "system",
  "source.provider": DATASET_PROVIDER,
  isActive: { $ne: false },
};

const isLegacyExercise = (exercise) =>
  Boolean(
    exercise &&
      exercise.type === "system" &&
      exercise.source?.provider !== DATASET_PROVIDER,
  );

const cleanAlternative = (alternative, legacyId, target) => {
  if (!sameId(alternative?.exerciseId, legacyId)) return { ...alternative };
  return {
    ...alternative,
    exerciseId: idOf(target._id),
    name: targetName(target),
    muscle: targetMuscle(target),
    image: targetImage(target),
    imagePublicId: targetImagePublicId(target),
    supportsUnilateral: Boolean(target.supportsUnilateral),
    movementMode: target.movementMode || "bilateral",
  };
};

const mergeAlternatives = (primaryId, alternatives = []) => {
  const seen = new Set();
  return alternatives.filter((alternative) => {
    const exerciseId = idOf(alternative?.exerciseId);
    if (!exerciseId || sameId(exerciseId, primaryId) || seen.has(exerciseId)) {
      return false;
    }
    seen.add(exerciseId);
    return true;
  });
};

const mergeRoutineExercise = (base, incoming, target) => ({
  ...base,
  exerciseId: idOf(target._id),
  name: targetName(target),
  sets: Math.max(Number(base.sets) || 0, Number(incoming.sets) || 0, 1),
  supportsUnilateral: Boolean(target.supportsUnilateral),
  movementMode: target.movementMode || "bilateral",
  isExtra: Boolean(base.isExtra && incoming.isExtra),
  muscle: targetMuscle(target),
  image: targetImage(target),
  imagePublicId: targetImagePublicId(target),
  alternatives: mergeAlternatives(idOf(target._id), [
    ...(base.alternatives || []),
    ...(incoming.alternatives || []),
  ]),
});

export const migrateRoutineExerciseList = (
  exercises = [],
  legacyId,
  target,
) => {
  const next = [];
  let targetIndex = -1;

  exercises.forEach((exercise) => {
    const converted = sameId(exercise.exerciseId, legacyId)
      ? {
          ...exercise,
          exerciseId: idOf(target._id),
          name: targetName(target),
          supportsUnilateral: Boolean(target.supportsUnilateral),
          movementMode: target.movementMode || "bilateral",
          muscle: targetMuscle(target),
          image: targetImage(target),
          imagePublicId: targetImagePublicId(target),
        }
      : { ...exercise };

    converted.alternatives = mergeAlternatives(
      converted.exerciseId,
      (converted.alternatives || []).map((alternative) =>
        cleanAlternative(alternative, legacyId, target),
      ),
    );

    if (sameId(converted.exerciseId, target._id)) {
      if (targetIndex < 0) {
        targetIndex = next.length;
        next.push(converted);
      } else {
        next[targetIndex] = mergeRoutineExercise(
          next[targetIndex],
          converted,
          target,
        );
      }
      return;
    }
    next.push(converted);
  });

  return next.map((exercise) => ({
    ...exercise,
    alternatives: mergeAlternatives(exercise.exerciseId, exercise.alternatives),
  }));
};

const firstPositive = (...values) => {
  const positives = values.map(Number).filter((value) => value > 0);
  return positives.length ? Math.min(...positives) : 0;
};

const mergeSetupNotes = (left = "", right = "") =>
  [...new Set([left, right].map((value) => String(value || "").trim()).filter(Boolean))]
    .join("; ")
    .slice(0, 240);

const mergeTrainingExercise = (base, incoming, target) => ({
  ...base,
  exerciseId: idOf(target._id),
  exerciseName: targetName(target),
  muscleGroup: targetMuscle(target),
  order: firstPositive(base.order, incoming.order),
  plannedOrder: firstPositive(base.plannedOrder, incoming.plannedOrder),
  actualOrder: firstPositive(base.actualOrder, incoming.actualOrder),
  movementMode: target.movementMode || base.movementMode || "bilateral",
  setupNote: mergeSetupNotes(base.setupNote, incoming.setupNote),
  sets: [...(base.sets || []), ...(incoming.sets || [])].map((set, index) => ({
    ...set,
    order: index + 1,
  })),
});

const migrateTrainingExercises = (exercises = [], legacyId, target) => {
  const next = [];
  let targetIndex = -1;
  exercises.forEach((exercise) => {
    const converted = sameId(exercise.exerciseId, legacyId)
      ? {
          ...exercise,
          exerciseId: idOf(target._id),
          exerciseName: targetName(target),
          muscleGroup: targetMuscle(target),
          movementMode: target.movementMode || "bilateral",
        }
      : { ...exercise };
    if (sameId(converted.exerciseId, target._id)) {
      if (targetIndex < 0) {
        targetIndex = next.length;
        next.push(converted);
      } else {
        next[targetIndex] = mergeTrainingExercise(
          next[targetIndex],
          converted,
          target,
        );
      }
      return;
    }
    next.push(converted);
  });
  return next;
};

const mergeDuration = (left, right) => {
  const leftDuration = Number(left.durationSeconds) || 0;
  const rightDuration = Number(right.durationSeconds) || 0;
  const hasOverride =
    (left.durationOverrideSeconds !== null &&
      left.durationOverrideSeconds !== undefined) ||
    (right.durationOverrideSeconds !== null &&
      right.durationOverrideSeconds !== undefined);
  const effectiveLeft = Number(left.durationOverrideSeconds ?? leftDuration) || 0;
  const effectiveRight = Number(right.durationOverrideSeconds ?? rightDuration) || 0;
  return {
    exerciseId: left.exerciseId,
    durationSeconds: leftDuration + rightDuration,
    durationOverrideSeconds: hasOverride
      ? effectiveLeft + effectiveRight
      : null,
  };
};

const migrateDurations = (durations = [], legacyId, targetId) => {
  const next = [];
  let targetIndex = -1;
  durations.forEach((duration) => {
    const converted = sameId(duration.exerciseId, legacyId)
      ? { ...duration, exerciseId: targetId }
      : { ...duration };
    if (sameId(converted.exerciseId, targetId)) {
      if (targetIndex < 0) {
        targetIndex = next.length;
        next.push(converted);
      } else {
        next[targetIndex] = mergeDuration(next[targetIndex], converted);
      }
      return;
    }
    next.push(converted);
  });
  return next;
};

export const migrateTrainingDocument = (training = {}, legacyId, target) => {
  const targetId = idOf(target._id);
  const exercises = migrateTrainingExercises(
    training.exercises || [],
    legacyId,
    target,
  );
  return {
    exercises,
    orderSignature: exercises
      .map((exercise) => exercise.exerciseId || "")
      .filter(Boolean)
      .join("|"),
    timeEvents: (training.timeEvents || []).map((event) =>
      sameId(event.exerciseId, legacyId)
        ? { ...event, exerciseId: targetId }
        : { ...event },
    ),
    exerciseDurations: migrateDurations(
      training.exerciseDurations || [],
      legacyId,
      targetId,
    ),
  };
};

export const getExerciseReferenceCounts = async (exerciseId) => {
  const [routines, trainings, sessions] = await Promise.all([
    Routine.countDocuments({
      $or: [
        { "exercises.exerciseId": exerciseId },
        { "exercises.alternatives.exerciseId": exerciseId },
      ],
    }),
    Training.countDocuments({
      $or: [
        { "exercises.exerciseId": exerciseId },
        { "timeEvents.exerciseId": exerciseId },
        { "exerciseDurations.exerciseId": exerciseId },
      ],
    }),
    Session.countDocuments({ exerciseId }),
  ]);
  return {
    routines,
    trainings,
    sessions,
    total: routines + trainings + sessions,
  };
};

const buildReferenceMap = async (exerciseIds) => {
  const idSet = new Set(exerciseIds.map(idOf));
  const map = new Map(
    [...idSet].map((exerciseId) => [
      exerciseId,
      { routines: 0, trainings: 0, sessions: 0, total: 0 },
    ]),
  );
  if (!idSet.size) return map;

  const [routines, trainings, sessions] = await Promise.all([
    Routine.find(
      {
        $or: [
          { "exercises.exerciseId": { $in: [...idSet] } },
          { "exercises.alternatives.exerciseId": { $in: [...idSet] } },
        ],
      },
      "exercises.exerciseId exercises.alternatives.exerciseId",
    ).lean(),
    Training.find(
      {
        $or: [
          { "exercises.exerciseId": { $in: [...idSet] } },
          { "timeEvents.exerciseId": { $in: [...idSet] } },
          { "exerciseDurations.exerciseId": { $in: [...idSet] } },
        ],
      },
      "exercises.exerciseId timeEvents.exerciseId exerciseDurations.exerciseId",
    ).lean(),
    Session.aggregate([
      { $match: { exerciseId: { $in: [...idSet] } } },
      { $group: { _id: "$exerciseId", count: { $sum: 1 } } },
    ]),
  ]);

  routines.forEach((routine) => {
    const ids = new Set(
      (routine.exercises || []).flatMap((exercise) => [
        idOf(exercise.exerciseId),
        ...(exercise.alternatives || []).map((item) => idOf(item.exerciseId)),
      ]),
    );
    ids.forEach((exerciseId) => {
      if (map.has(exerciseId)) map.get(exerciseId).routines += 1;
    });
  });
  trainings.forEach((training) => {
    const ids = new Set([
      ...(training.exercises || []).map((item) => idOf(item.exerciseId)),
      ...(training.timeEvents || []).map((item) => idOf(item.exerciseId)),
      ...(training.exerciseDurations || []).map((item) => idOf(item.exerciseId)),
    ]);
    ids.forEach((exerciseId) => {
      if (map.has(exerciseId)) map.get(exerciseId).trainings += 1;
    });
  });
  sessions.forEach((item) => {
    if (map.has(idOf(item._id))) map.get(idOf(item._id)).sessions = item.count;
  });
  map.forEach((counts) => {
    counts.total = counts.routines + counts.trainings + counts.sessions;
  });
  return map;
};

const serializeExercise = (exercise, references = null) => ({
  id: idOf(exercise._id),
  name: targetName(exercise),
  nameEnglish: exercise.localizedNames?.en || exercise.name || "",
  muscle: targetMuscle(exercise),
  equipment: exercise.equipment || [],
  image: targetImage(exercise),
  isActive: exercise.isActive !== false,
  sourceProvider: exercise.source?.provider || "catalogo-anterior",
  mergedIntoExerciseId: exercise.mergedIntoExerciseId || "",
  createdAt: exercise.createdAt || null,
  references,
});

const compareMigrationCandidates = (left, right) => {
  const referenceDifference =
    (Number(right.references?.total) || 0) -
    (Number(left.references?.total) || 0);
  if (referenceDifference !== 0) return referenceDifference;
  return String(left.name || "").localeCompare(String(right.name || ""), "es", {
    sensitivity: "base",
  });
};

export const listExerciseMigrationCandidates = async () => {
  const [legacyExercises, targetExercises, recent] = await Promise.all([
    Exercise.find(legacyCatalogFilter)
      .select(
        "name localizedNames primaryMuscleGroup primaryMuscle muscle equipment image thumb imagePublicId media source isActive mergedIntoExerciseId createdAt",
      )
      .sort({ "localizedNames.es": 1, name: 1 })
      .lean(),
    Exercise.find(currentCatalogFilter)
      .select(
        "name localizedNames primaryMuscleGroup primaryMuscle muscle equipment image thumb imagePublicId media source isActive createdAt",
      )
      .sort({ "localizedNames.es": 1, name: 1 })
      .lean(),
    ExerciseMigration.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);
  const referenceMap = await buildReferenceMap(
    legacyExercises.map((exercise) => exercise._id),
  );
  const legacy = legacyExercises
    .map((exercise) =>
      serializeExercise(exercise, referenceMap.get(idOf(exercise._id))),
    )
    .sort(compareMigrationCandidates);
  return {
    provider: DATASET_PROVIDER,
    summary: {
      legacy: legacy.length,
      withReferences: legacy.filter((item) => item.references?.total > 0).length,
      removable: legacy.filter((item) => item.references?.total === 0).length,
      targets: targetExercises.length,
    },
    legacy,
    targets: targetExercises.map((exercise) => serializeExercise(exercise)),
    recent: recent.map((item) => ({
      id: idOf(item._id),
      operation: item.operation,
      sourceExercise: item.sourceExercise,
      targetExercise: item.targetExercise,
      references: item.references,
      sourceDeleted: item.sourceDeleted,
      createdAt: item.createdAt,
    })),
  };
};

const migrateRoutineDocuments = async (legacyId, target) => {
  const documents = await Routine.find({
    $or: [
      { "exercises.exerciseId": legacyId },
      { "exercises.alternatives.exerciseId": legacyId },
    ],
  }).lean();
  if (!documents.length) return 0;
  await Routine.bulkWrite(
    documents.map((routine) => ({
      updateOne: {
        filter: { _id: routine._id },
        update: {
          $set: {
            exercises: migrateRoutineExerciseList(
              routine.exercises,
              legacyId,
              target,
            ),
            version: Math.max(1, Number(routine.version) || 1) + 1,
          },
        },
      },
    })),
    { ordered: false },
  );
  return documents.length;
};

const migrateTrainingDocuments = async (legacyId, target) => {
  const documents = await Training.find({
    $or: [
      { "exercises.exerciseId": legacyId },
      { "timeEvents.exerciseId": legacyId },
      { "exerciseDurations.exerciseId": legacyId },
    ],
  }).lean();
  if (!documents.length) return 0;
  await Training.bulkWrite(
    documents.map((training) => ({
      updateOne: {
        filter: { _id: training._id },
        update: {
          $set: migrateTrainingDocument(training, legacyId, target),
        },
      },
    })),
    { ordered: false },
  );
  return documents.length;
};

const preserveLegacyMetadata = async (legacy, target) => {
  const aliases = [
    legacy.localizedNames?.es,
    legacy.localizedNames?.en,
    legacy.name,
    ...(legacy.aliases || []),
  ].filter(Boolean);
  const update = { $addToSet: { aliases: { $each: aliases } } };
  const hasMedia =
    legacy.media?.image?.url ||
    legacy.media?.animation?.url ||
    legacy.image;
  if (hasMedia) {
    update.$addToSet.alternateMedia = {
      sourceExerciseId: idOf(legacy._id),
      label: targetName(legacy),
      image: legacy.media?.image || { url: legacy.image || "" },
      animation: legacy.media?.animation || {},
    };
  }
  await Exercise.updateOne({ _id: target._id }, update);
};

export const migrateExercise = async ({
  legacyExerciseId,
  targetExerciseId,
  deleteLegacy = true,
  performedBy,
}) => {
  if (!legacyExerciseId || !targetExerciseId) {
    const error = new Error("Selecciona el ejercicio antiguo y el nuevo");
    error.statusCode = 400;
    throw error;
  }
  if (sameId(legacyExerciseId, targetExerciseId)) {
    const error = new Error("El ejercicio de origen y destino deben ser distintos");
    error.statusCode = 400;
    throw error;
  }

  const [legacy, target] = await Promise.all([
    Exercise.findById(legacyExerciseId).lean(),
    Exercise.findOne({ _id: targetExerciseId, ...currentCatalogFilter }).lean(),
  ]);
  if (!legacy || !isLegacyExercise(legacy)) {
    const error = new Error("El ejercicio antiguo no pertenece al catalogo legado");
    error.statusCode = 404;
    throw error;
  }
  if (!target) {
    const error = new Error("El ejercicio destino no pertenece al catalogo importado activo");
    error.statusCode = 404;
    throw error;
  }

  const before = await getExerciseReferenceCounts(legacyExerciseId);
  const [routinesModified, trainingsModified, sessionsResult] = await Promise.all([
    migrateRoutineDocuments(legacyExerciseId, target),
    migrateTrainingDocuments(legacyExerciseId, target),
    Session.updateMany(
      { exerciseId: legacyExerciseId },
      {
        $set: {
          exerciseId: idOf(target._id),
          exerciseName: targetName(target),
        },
      },
    ),
  ]);

  await CatalogSwitchState.updateMany(
    { "previousExercises.exerciseId": legacyExerciseId },
    { $set: { "previousExercises.$[item].exerciseId": idOf(target._id) } },
    { arrayFilters: [{ "item.exerciseId": legacyExerciseId }] },
  );
  await preserveLegacyMetadata(legacy, target);

  const remaining = await getExerciseReferenceCounts(legacyExerciseId);
  if (remaining.total > 0) {
    const error = new Error(
      "La migracion quedo incompleta. Puedes repetirla de forma segura.",
    );
    error.statusCode = 409;
    error.details = remaining;
    throw error;
  }

  if (deleteLegacy) {
    await Exercise.deleteOne({ _id: legacyExerciseId });
  } else {
    await Exercise.updateOne(
      { _id: legacyExerciseId },
      {
        $set: {
          isActive: false,
          mergedIntoExerciseId: idOf(target._id),
          classificationStatus: "reviewed",
          updatedBy: performedBy,
        },
      },
    );
  }

  await ExerciseMigration.create({
    operation: "migrate",
    sourceExercise: { id: legacyExerciseId, name: targetName(legacy) },
    targetExercise: { id: idOf(target._id), name: targetName(target) },
    references: before,
    sourceDeleted: Boolean(deleteLegacy),
    performedBy,
  });

  return {
    ok: true,
    sourceDeleted: Boolean(deleteLegacy),
    sourceExercise: { id: legacyExerciseId, name: targetName(legacy) },
    targetExercise: { id: idOf(target._id), name: targetName(target) },
    references: before,
    modified: {
      routines: routinesModified,
      trainings: trainingsModified,
      sessions: sessionsResult.modifiedCount || 0,
    },
  };
};

export const deleteLegacyExercise = async ({ exerciseId, performedBy }) => {
  const exercise = await Exercise.findById(exerciseId).lean();
  if (!exercise || !isLegacyExercise(exercise)) {
    const error = new Error("El ejercicio antiguo no existe");
    error.statusCode = 404;
    throw error;
  }
  const references = await getExerciseReferenceCounts(exerciseId);
  if (references.total > 0) {
    const error = new Error(
      "El ejercicio todavia tiene referencias. Migralo antes de eliminarlo.",
    );
    error.statusCode = 409;
    error.details = references;
    throw error;
  }
  await Promise.all([
    Exercise.deleteOne({ _id: exerciseId }),
    CatalogSwitchState.updateMany(
      { "previousExercises.exerciseId": exerciseId },
      { $pull: { previousExercises: { exerciseId } } },
    ),
  ]);
  await ExerciseMigration.create({
    operation: "delete",
    sourceExercise: { id: exerciseId, name: targetName(exercise) },
    targetExercise: { id: "", name: "" },
    references,
    sourceDeleted: true,
    performedBy,
  });
  return {
    ok: true,
    sourceDeleted: true,
    sourceExercise: { id: exerciseId, name: targetName(exercise) },
    references,
  };
};
