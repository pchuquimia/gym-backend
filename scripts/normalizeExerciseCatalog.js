import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import Session from "../src/models/Session.js";
import CatalogSwitchState from "../src/models/CatalogSwitchState.js";
import {
  buildExerciseIdentityKey,
  classifyExerciseTaxonomy,
  normalizeTaxonomyKey,
} from "../src/utils/exerciseTaxonomy.js";

const apply = process.argv.includes("--apply");
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym";

const VARIANT_NAMES = {
  "dataset-hasane-0027": {
    es: "Remo inclinado con barra",
    en: "Barbell bent-over row",
  },
  "dataset-hasane-0049": {
    es: "Remo con barra apoyado en banco inclinado",
    en: "Barbell incline bench row",
  },
  "dataset-hasane-0293": {
    es: "Remo inclinado con mancuernas",
    en: "Dumbbell bent-over row",
  },
  "dataset-hasane-0327": {
    es: "Remo con mancuernas apoyado en banco inclinado",
    en: "Dumbbell incline bench row",
  },
  "dataset-hasane-0296": {
    es: "Press cerrado con mancuernas en agarre neutro",
    en: "Dumbbell neutral-grip close press",
  },
  "dataset-hasane-1731": {
    es: "Press cerrado con mancuernas juntas",
    en: "Dumbbell squeeze close-grip press",
  },
  "dataset-hasane-0454": {
    es: "Spider curl con barra EZ en banco inclinado",
    en: "EZ-bar spider curl on incline bench",
  },
  "dataset-hasane-1628": {
    es: "Spider curl con barra EZ en banco predicador",
    en: "EZ-bar spider curl on preacher bench",
  },
  "dataset-hasane-0576": {
    es: "Press de pecho en máquina convergente con discos",
    en: "Plate-loaded converging chest press",
  },
  "dataset-hasane-0577": {
    es: "Press de pecho en máquina selectorizada",
    en: "Selectorized machine chest press",
  },
  "dataset-hasane-0655": {
    es: "Flexiones con manos sobre fitball",
    en: "Push-up with hands on stability ball",
  },
  "dataset-hasane-0656": {
    es: "Flexiones con pies sobre fitball",
    en: "Push-up with feet on stability ball",
  },
  "dataset-hasane-0697": {
    es: "Curl nórdico inverso asistido en máquina",
    en: "Machine-assisted inverse Nordic curl",
  },
  "dataset-hasane-1766": {
    es: "Curl nórdico inverso asistido con banco",
    en: "Bench-assisted inverse Nordic curl",
  },
  "dataset-hasane-0763": {
    es: "Elevación tibial inversa en Smith con barra sobre hombros",
    en: "Smith reverse calf raise with bar on shoulders",
  },
  "dataset-hasane-1394": {
    es: "Elevación tibial inversa en Smith con barra detrás",
    en: "Smith reverse calf raise with bar behind body",
  },
};

const MERGE_PAIRS = [
  {
    winnerId: "dataset-hasane-0088",
    loserId: "dataset-hasane-1371",
    names: {
      es: "Elevación de pantorrillas sentado con barra",
      en: "Barbell seated calf raise",
    },
  },
  {
    winnerId: "dataset-hasane-0422",
    loserId: "dataset-hasane-1680",
    names: {
      es: "Curl unilateral de pie apoyado en banco inclinado",
      en: "Standing one-arm curl over incline bench",
    },
  },
];

const mergeNamesById = new Map(
  MERGE_PAIRS.flatMap((pair) => [
    [pair.winnerId, pair.names],
    [pair.loserId, pair.names],
  ]),
);
const loserIds = new Set(MERGE_PAIRS.map((pair) => pair.loserId));
const toPlain = (document) => document.toObject({ depopulate: true });
const normalizeName = (value) => normalizeTaxonomyKey(value)
  .replace(/[^a-z0-9 ]/g, "")
  .replace(/\s+/g, " ")
  .trim();
const duplicateGroups = (documents, language) => {
  const grouped = new Map();
  documents.filter((item) => item.isActive !== false).forEach((item) => {
    const name = item.localizedNames?.[language] || item.name;
    const key = normalizeName(name);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), item._id]);
  });
  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids }));
};
const missingMetrics = (documents) => {
  const active = documents.filter((item) => item.isActive !== false);
  const missing = (field) => active.filter((item) => !item[field]).length;
  return {
    movementPattern: missing("movementPattern"),
    exerciseType: missing("exerciseType"),
    laterality: missing("laterality"),
    kineticChain: missing("kineticChain"),
    stability: missing("stability"),
    position: missing("position"),
    difficulty: missing("difficulty"),
  };
};

const buildNormalizedExercise = (document) => {
  const current = toPlain(document);
  const names = VARIANT_NAMES[current._id] || mergeNamesById.get(current._id);
  const previousNames = names
    ? [current.localizedNames?.es, current.localizedNames?.en, current.name]
        .filter(Boolean)
        .filter((name) => ![names.es, names.en].includes(name))
    : [];
  const named = names
    ? {
        ...current,
        name: names.en,
        localizedNames: { ...(current.localizedNames || {}), ...names },
        aliases: [...new Set([
          ...(current.aliases || []),
          ...previousNames,
        ])],
      }
    : current;
  const taxonomy = classifyExerciseTaxonomy(named);
  const normalized = {
    ...named,
    ...taxonomy,
    identityKey: buildExerciseIdentityKey({ ...named, ...taxonomy }),
  };
  if (current.source?.provider === "hasaneyldrm") {
    normalized.classificationStatus = names ? "reviewed" : "partially_mapped";
  }
  if (loserIds.has(current._id)) normalized.isActive = false;
  return normalized;
};

const changedSet = (current, normalized) => {
  const fields = [
    "name",
    "localizedNames",
    "aliases",
    "category",
    "categories",
    "bodyRegion",
    "navigationRegion",
    "primaryMuscleGroup",
    "muscle",
    "primaryMuscle",
    "movementPattern",
    "movementPatterns",
    "equipment",
    "exerciseType",
    "laterality",
    "kineticChain",
    "executionType",
    "stability",
    "position",
    "difficulty",
    "goals",
    "movementMode",
    "supportsUnilateral",
    "taxonomyVersion",
    "identityKey",
    "classificationStatus",
  ];
  return Object.fromEntries(fields
    .filter((field) => JSON.stringify(current[field]) !== JSON.stringify(normalized[field]))
    .map((field) => [field, normalized[field]]));
};

const referenceCounts = async (loserId) => ({
  routines: await Routine.countDocuments({
    $or: [
      { "exercises.exerciseId": loserId },
      { "exercises.alternatives.exerciseId": loserId },
    ],
  }),
  trainings: await Training.countDocuments({
    $or: [
      { "exercises.exerciseId": loserId },
      { "timeEvents.exerciseId": loserId },
      { "exerciseDurations.exerciseId": loserId },
    ],
  }),
  sessions: await Session.countDocuments({ exerciseId: loserId }),
});

const migrateReferences = async (winner, loser) => {
  await Routine.updateMany(
    { "exercises.exerciseId": loser._id },
    {
      $set: {
        "exercises.$[exercise].exerciseId": winner._id,
        "exercises.$[exercise].name": winner.localizedNames?.es || winner.name,
      },
    },
    { arrayFilters: [{ "exercise.exerciseId": loser._id }] },
  );
  await Routine.updateMany(
    { "exercises.alternatives.exerciseId": loser._id },
    {
      $set: {
        "exercises.$[].alternatives.$[alternative].exerciseId": winner._id,
        "exercises.$[].alternatives.$[alternative].name": winner.localizedNames?.es || winner.name,
      },
    },
    { arrayFilters: [{ "alternative.exerciseId": loser._id }] },
  );
  await Training.updateMany(
    { "exercises.exerciseId": loser._id },
    { $set: { "exercises.$[exercise].exerciseId": winner._id } },
    { arrayFilters: [{ "exercise.exerciseId": loser._id }] },
  );
  await Training.updateMany(
    { "timeEvents.exerciseId": loser._id },
    { $set: { "timeEvents.$[event].exerciseId": winner._id } },
    { arrayFilters: [{ "event.exerciseId": loser._id }] },
  );
  await Training.updateMany(
    { "exerciseDurations.exerciseId": loser._id },
    { $set: { "exerciseDurations.$[duration].exerciseId": winner._id } },
    { arrayFilters: [{ "duration.exerciseId": loser._id }] },
  );
  await Session.updateMany(
    { exerciseId: loser._id },
    { $set: { exerciseId: winner._id } },
  );
  await CatalogSwitchState.updateMany(
    { "previousExercises.exerciseId": loser._id },
    { $set: { "previousExercises.$[exercise].exerciseId": winner._id } },
    { arrayFilters: [{ "exercise.exerciseId": loser._id }] },
  );

  const alternateMedia = {
    sourceExerciseId: loser._id,
    label: loser.localizedNames?.es || loser.name,
    image: loser.media?.image || {},
    animation: loser.media?.animation || {},
  };
  await Exercise.updateOne(
    { _id: winner._id },
    {
      $addToSet: {
        aliases: {
          $each: [loser.localizedNames?.es, loser.localizedNames?.en, loser.name]
            .filter(Boolean),
        },
        alternateMedia,
      },
    },
  );
  await Exercise.updateOne(
    { _id: loser._id },
    {
      $set: {
        isActive: false,
        mergedIntoExerciseId: winner._id,
        classificationStatus: "reviewed",
      },
    },
  );
};

await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
try {
  const documents = await Exercise.find({}).sort({ _id: 1 });
  const before = documents.map(toPlain);
  const normalized = documents.map(buildNormalizedExercise);
  const operations = documents.flatMap((document, index) => {
    const set = changedSet(before[index], normalized[index]);
    return Object.keys(set).length
      ? [{ updateOne: { filter: { _id: document._id }, update: { $set: set } } }]
      : [];
  });
  const mergePlan = [];
  for (const pair of MERGE_PAIRS) {
    mergePlan.push({
      ...pair,
      references: await referenceCounts(pair.loserId),
    });
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    total: documents.length,
    exercisesToNormalize: operations.length,
    before: {
      active: before.filter((item) => item.isActive !== false).length,
      missing: missingMetrics(before),
      duplicateSpanishNames: duplicateGroups(before, "es").length,
      duplicateEnglishNames: duplicateGroups(before, "en").length,
    },
    after: {
      active: normalized.filter((item) => item.isActive !== false).length,
      missing: missingMetrics(normalized),
      duplicateSpanishNames: duplicateGroups(normalized, "es").length,
      duplicateEnglishNames: duplicateGroups(normalized, "en").length,
      categories: Object.fromEntries(Object.entries(normalized
        .filter((item) => item.isActive !== false)
        .reduce((counts, item) => {
          counts[item.category] = (counts[item.category] || 0) + 1;
          return counts;
        }, {})).sort((a, b) => b[1] - a[1])),
    },
    mergePlan,
  };

  if (apply) {
    if (operations.length) await Exercise.bulkWrite(operations, { ordered: false });
    for (const pair of MERGE_PAIRS) {
      const winner = await Exercise.findById(pair.winnerId);
      const loser = await Exercise.findById(pair.loserId);
      if (winner && loser) await migrateReferences(winner, loser);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await mongoose.disconnect();
}
