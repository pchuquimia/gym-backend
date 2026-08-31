import CatalogSwitchState from "../models/CatalogSwitchState.js";
import Exercise from "../models/Exercise.js";
import ExerciseMigration from "../models/ExerciseMigration.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
import { loadInConcurrentPages } from "../utils/concurrentPagination.js";

export const DATASET_PROVIDER = "hasaneyldrm";
const MIGRATION_CATALOG_PAGE_SIZE = 200;
const MIGRATION_CATALOG_CONCURRENCY = 8;
const MIGRATION_CANDIDATES_CACHE_TTL_MS = 5 * 60 * 1000;
const MIGRATION_CATALOG_FIELDS =
  "name localizedNames primaryMuscleGroup primaryMuscle muscle equipment image thumb media.thumbnail.url media.image.url source.provider isActive mergedIntoExerciseId createdAt";
let migrationCandidatesCache = null;

export const clearExerciseMigrationCandidatesCache = () => {
  migrationCandidatesCache = null;
};

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
  isActive: true,
};

const activeMergeScope = (ownerId) => ({
  isActive: { $ne: false },
  $and: [
    {
      $or: [
        { mergedIntoExerciseId: { $exists: false } },
        { mergedIntoExerciseId: "" },
        { mergedIntoExerciseId: null },
      ],
    },
    {
      $or: [{ type: "system" }, { type: "custom", ownerId }],
    },
  ],
});

const migrationCatalogFilter = {
  type: "system",
  $or: [
    { "source.provider": { $ne: DATASET_PROVIDER } },
    {
      "source.provider": DATASET_PROVIDER,
      isActive: true,
    },
  ],
};

const loadMigrationCatalogDocuments = () =>
  loadInConcurrentPages({
    pageSize: MIGRATION_CATALOG_PAGE_SIZE,
    concurrency: MIGRATION_CATALOG_CONCURRENCY,
    fetchPage: ({ skip, limit }) =>
      Exercise.find(migrationCatalogFilter, MIGRATION_CATALOG_FIELDS)
        .sort({ _id: 1 })
        .skip(skip)
        .limit(limit)
        .batchSize(limit)
        .maxTimeMS(10000)
        .lean(),
  });

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
  [
    ...new Set(
      [left, right].map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ]
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
  const effectiveLeft =
    Number(left.durationOverrideSeconds ?? leftDuration) || 0;
  const effectiveRight =
    Number(right.durationOverrideSeconds ?? rightDuration) || 0;
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
  const [routines, trainingDocuments, sessionDocuments] = await Promise.all([
    Routine.countDocuments({
      $or: [
        { "exercises.exerciseId": exerciseId },
        { "exercises.alternatives.exerciseId": exerciseId },
      ],
    }),
    Training.find(
      {
        $or: [
          { "exercises.exerciseId": exerciseId },
          { "timeEvents.exerciseId": exerciseId },
          { "exerciseDurations.exerciseId": exerciseId },
        ],
      },
      "exercises.exerciseId",
    ).lean(),
    Session.find({ exerciseId }, "trainingId").lean(),
  ]);
  const sessionKeys = new Set();
  trainingDocuments.forEach((training) => {
    if (
      (training.exercises || []).some((exercise) =>
        sameId(exercise.exerciseId, exerciseId),
      )
    ) {
      sessionKeys.add(`training:${idOf(training._id)}`);
    }
  });
  sessionDocuments.forEach((session) => {
    sessionKeys.add(
      session.trainingId
        ? `training:${idOf(session.trainingId)}`
        : `session:${idOf(session._id)}`,
    );
  });
  const trainings = trainingDocuments.length;
  const sessions = sessionDocuments.length;
  return {
    routines,
    trainings,
    sessions,
    uniqueSessions: sessionKeys.size,
    total: routines + trainings + sessions,
  };
};

const buildReferenceMap = async (exerciseIds, { ownerId = "" } = {}) => {
  const idSet = new Set(exerciseIds.map(idOf));
  const map = new Map(
    [...idSet].map((exerciseId) => [
      exerciseId,
      {
        routines: 0,
        trainings: 0,
        sessions: 0,
        uniqueSessions: 0,
        total: 0,
      },
    ]),
  );
  const uniqueSessionMap = new Map(
    [...idSet].map((exerciseId) => [exerciseId, new Set()]),
  );
  if (!idSet.size) return map;

  const routineFilter = {
    $or: [
      { "exercises.exerciseId": { $in: [...idSet] } },
      { "exercises.alternatives.exerciseId": { $in: [...idSet] } },
    ],
  };
  const trainingFilter = {
    $or: [
      { "exercises.exerciseId": { $in: [...idSet] } },
      { "timeEvents.exerciseId": { $in: [...idSet] } },
      { "exerciseDurations.exerciseId": { $in: [...idSet] } },
    ],
  };
  const sessionFilter = { exerciseId: { $in: [...idSet] } };
  if (ownerId) {
    routineFilter.ownerId = idOf(ownerId);
    trainingFilter.ownerId = idOf(ownerId);
    sessionFilter.ownerId = idOf(ownerId);
  }

  const [routines, trainings, sessions] = await Promise.all([
    Routine.find(
      routineFilter,
      "exercises.exerciseId exercises.alternatives.exerciseId",
    )
      .batchSize(500)
      .lean(),
    Training.find(
      trainingFilter,
      "exercises.exerciseId timeEvents.exerciseId exerciseDurations.exerciseId",
    )
      .batchSize(500)
      .lean(),
    Session.find(sessionFilter, "exerciseId trainingId").lean(),
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
    const performedIds = new Set(
      (training.exercises || []).map((item) => idOf(item.exerciseId)),
    );
    const ids = new Set([
      ...performedIds,
      ...(training.timeEvents || []).map((item) => idOf(item.exerciseId)),
      ...(training.exerciseDurations || []).map((item) =>
        idOf(item.exerciseId),
      ),
    ]);
    ids.forEach((exerciseId) => {
      if (map.has(exerciseId)) map.get(exerciseId).trainings += 1;
    });
    performedIds.forEach((exerciseId) => {
      if (uniqueSessionMap.has(exerciseId)) {
        uniqueSessionMap.get(exerciseId).add(`training:${idOf(training._id)}`);
      }
    });
  });
  sessions.forEach((session) => {
    const exerciseId = idOf(session.exerciseId);
    if (!map.has(exerciseId)) return;
    map.get(exerciseId).sessions += 1;
    uniqueSessionMap
      .get(exerciseId)
      .add(
        session.trainingId
          ? `training:${idOf(session.trainingId)}`
          : `session:${idOf(session._id)}`,
      );
  });
  map.forEach((counts, exerciseId) => {
    counts.uniqueSessions = uniqueSessionMap.get(exerciseId)?.size || 0;
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

const loadExerciseMigrationCandidates = async () => {
  const [catalogExercises, recent, legacyData] = await Promise.all([
    loadMigrationCatalogDocuments(),
    ExerciseMigration.find({}).sort({ createdAt: -1 }).limit(8).lean(),
    Exercise.distinct("_id", legacyCatalogFilter).then(
      async (legacyExerciseIds) => ({
        legacyExerciseIds,
        referenceMap: await buildReferenceMap(legacyExerciseIds),
      }),
    ),
  ]);
  const { legacyExerciseIds, referenceMap } = legacyData;
  const legacyIdSet = new Set(legacyExerciseIds.map(idOf));
  const legacyExercises = catalogExercises.filter((exercise) =>
    legacyIdSet.has(idOf(exercise._id)),
  );
  const targetExercises = catalogExercises.filter(
    (exercise) =>
      exercise.source?.provider === DATASET_PROVIDER &&
      exercise.isActive !== false,
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
      withReferences: legacy.filter((item) => item.references?.total > 0)
        .length,
      removable: legacy.filter((item) => item.references?.total === 0).length,
      targets: targetExercises.length,
    },
    legacy,
    targets: targetExercises
      .map((exercise) => serializeExercise(exercise))
      .sort((left, right) =>
        left.name.localeCompare(right.name, "es", { sensitivity: "base" }),
      ),
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

export const listExerciseMigrationCandidates = async () => {
  if (
    migrationCandidatesCache?.value &&
    migrationCandidatesCache.expiresAt > Date.now()
  ) {
    return migrationCandidatesCache.value;
  }
  if (
    migrationCandidatesCache?.promise &&
    migrationCandidatesCache.expiresAt > Date.now()
  ) {
    return migrationCandidatesCache.promise;
  }

  const promise = loadExerciseMigrationCandidates();
  migrationCandidatesCache = {
    expiresAt: Date.now() + MIGRATION_CANDIDATES_CACHE_TTL_MS,
    promise,
  };
  try {
    const value = await promise;
    migrationCandidatesCache = {
      expiresAt: Date.now() + MIGRATION_CANDIDATES_CACHE_TTL_MS,
      value,
    };
    return value;
  } catch (error) {
    clearExerciseMigrationCandidatesCache();
    throw error;
  }
};

export const listExerciseMergeCandidates = async ({ ownerId }) => {
  const exercises = await Exercise.find(
    activeMergeScope(ownerId),
    `${MIGRATION_CATALOG_FIELDS} type ownerId`,
  )
    .sort({ name: 1, _id: 1 })
    .lean();
  const referenceMap = await buildReferenceMap(
    exercises.map((exercise) => exercise._id),
    { ownerId },
  );

  return {
    items: exercises
      .map((exercise) =>
        serializeExercise(
          exercise,
          referenceMap.get(idOf(exercise._id)) || {
            routines: 0,
            trainings: 0,
            sessions: 0,
            uniqueSessions: 0,
            total: 0,
          },
        ),
      )
      .sort(compareMigrationCandidates),
  };
};

export const getExerciseMergeImpact = async ({ exerciseId, ownerId }) => {
  const exercise = await Exercise.findOne({
    _id: exerciseId,
    ...activeMergeScope(ownerId),
  }).lean();
  if (!exercise) {
    const error = new Error("El ejercicio no está disponible para fusionar");
    error.statusCode = 404;
    throw error;
  }
  return {
    exercise: serializeExercise(exercise),
    references: await getExerciseReferenceCounts(exerciseId),
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
    legacy.media?.image?.url || legacy.media?.animation?.url || legacy.image;
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
    const error = new Error(
      "El ejercicio de origen y destino deben ser distintos",
    );
    error.statusCode = 400;
    throw error;
  }

  const [legacy, target] = await Promise.all([
    Exercise.findById(legacyExerciseId).lean(),
    Exercise.findOne({ _id: targetExerciseId, ...currentCatalogFilter }).lean(),
  ]);
  if (!legacy || !isLegacyExercise(legacy)) {
    const error = new Error(
      "El ejercicio antiguo no pertenece al catalogo legado",
    );
    error.statusCode = 404;
    throw error;
  }
  if (!target) {
    const error = new Error(
      "El ejercicio destino no pertenece al catalogo importado activo",
    );
    error.statusCode = 404;
    throw error;
  }

  const before = await getExerciseReferenceCounts(legacyExerciseId);
  const [routinesModified, trainingsModified, sessionsResult] =
    await Promise.all([
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
  clearExerciseMigrationCandidatesCache();

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

export const mergeExercises = async ({
  sourceExerciseId,
  targetExerciseId,
  performedBy,
}) => {
  if (!sourceExerciseId || !targetExerciseId) {
    const error = new Error(
      "Selecciona el duplicado y el ejercicio a conservar",
    );
    error.statusCode = 400;
    throw error;
  }
  if (sameId(sourceExerciseId, targetExerciseId)) {
    const error = new Error(
      "Los ejercicios de origen y destino deben ser distintos",
    );
    error.statusCode = 400;
    throw error;
  }

  const scope = activeMergeScope(performedBy);
  const [source, target] = await Promise.all([
    Exercise.findOne({ _id: sourceExerciseId, ...scope }).lean(),
    Exercise.findOne({ _id: targetExerciseId, ...scope }).lean(),
  ]);
  if (!source) {
    const error = new Error("El ejercicio duplicado no está disponible");
    error.statusCode = 404;
    throw error;
  }
  if (!target) {
    const error = new Error(
      "El ejercicio que deseas conservar no está disponible",
    );
    error.statusCode = 404;
    throw error;
  }

  const before = await getExerciseReferenceCounts(sourceExerciseId);
  const [routinesModified, trainingsModified, sessionsResult] =
    await Promise.all([
      migrateRoutineDocuments(sourceExerciseId, target),
      migrateTrainingDocuments(sourceExerciseId, target),
      Session.updateMany(
        { exerciseId: sourceExerciseId },
        {
          $set: {
            exerciseId: idOf(target._id),
            exerciseName: targetName(target),
          },
        },
      ),
    ]);

  await CatalogSwitchState.updateMany(
    { "previousExercises.exerciseId": sourceExerciseId },
    { $set: { "previousExercises.$[item].exerciseId": idOf(target._id) } },
    { arrayFilters: [{ "item.exerciseId": sourceExerciseId }] },
  );
  await preserveLegacyMetadata(source, target);

  const remaining = await getExerciseReferenceCounts(sourceExerciseId);
  if (remaining.total > 0) {
    const error = new Error(
      "La fusión quedó incompleta. Puedes repetirla de forma segura.",
    );
    error.statusCode = 409;
    error.details = remaining;
    throw error;
  }

  await ExerciseMigration.create({
    operation: "merge",
    sourceExercise: { id: sourceExerciseId, name: targetName(source) },
    targetExercise: { id: idOf(target._id), name: targetName(target) },
    references: before,
    sourceDeleted: false,
    performedBy,
  });
  clearExerciseMigrationCandidatesCache();

  return {
    ok: true,
    sourceRetained: true,
    sourceExercise: { id: sourceExerciseId, name: targetName(source) },
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
  clearExerciseMigrationCandidatesCache();
  return {
    ok: true,
    sourceDeleted: true,
    sourceExercise: { id: exerciseId, name: targetName(exercise) },
    references,
  };
};
