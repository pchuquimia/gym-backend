const LOAD_TYPES = new Set([
  "external",
  "machine",
  "bodyweight",
  "assisted",
  "cardio",
  "unknown",
]);

const normalizeText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const asArray = (value) =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);

const includesAny = (text, terms) => terms.some((term) => text.includes(term));

export const classifyExerciseLoad = (exercise = {}) => {
  const explicit = normalizeText(exercise.loadType);
  if (LOAD_TYPES.has(explicit)) return explicit;
  const equipment = asArray(exercise.equipment).map(normalizeText);
  const text = normalizeText(
    [exercise.exerciseName, exercise.name, ...equipment].join(" "),
  );
  if (includesAny(text, ["asist", "assisted", "gravitron"])) return "assisted";
  if (
    includesAny(text, [
      "caminadora",
      "treadmill",
      "bicicleta",
      "bike",
      "eliptica",
      "ergometro",
      "escaladora",
      "stair",
    ])
  ) return "cardio";
  if (
    includesAny(text, ["maquina", "machine", "polea", "cable", "smith", "landmine"])
  ) return "machine";
  if (includesAny(text, ["lastrad", "weighted"])) return "external";
  if (
    includesAny(text, [
      "peso corporal",
      "bodyweight",
      "sin equipamiento",
      "barra de dominadas",
      "paralelas",
      "suspension",
      "trx",
    ]) ||
    (!equipment.length &&
      includesAny(text, ["dominada", "pull-up", "pull up", "flexion", "push-up", "push up", "fondos", "dips", "plancha", "plank", "burpee"]))
  ) return "bodyweight";
  if (
    includesAny(text, [
      "barra",
      "barbell",
      "mancuerna",
      "dumbbell",
      "kettlebell",
      "disco",
      "plate",
      "balon medicinal",
      "medicine ball",
      "trineo",
      "sled",
    ])
  ) return "external";
  return "unknown";
};

export const isCompletedSet = (set = {}) => {
  const entries = Array.isArray(set.entries) ? set.entries : [];
  if (entries.length) return entries.every((entry) => entry.done === true);
  return set.done === true;
};

export const hasRecordedSetData = (set = {}) => {
  const entries =
    Array.isArray(set.entries) && set.entries.length ? set.entries : [set];
  return entries.some((entry) => {
    const weight = entry.weightKg ?? entry.weight ?? entry.kg;
    const reps = entry.reps ?? entry.repetitions;
    return (
      entry.done === true ||
      Boolean(entry.completedAt) ||
      (weight !== null && weight !== undefined && weight !== "") ||
      (reps !== null && reps !== undefined && reps !== "")
    );
  });
};

export const getCompletedSetVolume = (set = {}) => {
  if (!isCompletedSet(set)) return 0;
  const entries =
    Array.isArray(set.entries) && set.entries.length ? set.entries : [set];
  return entries.reduce((sum, entry) => {
    const weight = Number(entry.weightKg ?? entry.weight ?? entry.kg ?? 0);
    const reps = Number(entry.reps ?? entry.repetitions ?? 0);
    return sum +
      (Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps > 0
        ? weight * reps
        : 0);
  }, 0);
};

export const getTrainingLoadMetrics = (exercises = []) => {
  const total = {
    recordedSets: 0,
    completedSets: 0,
    incompleteSets: 0,
    externalKg: 0,
    machineKg: 0,
    unknownKg: 0,
    assistanceKg: 0,
    bodyweightSets: 0,
    assistedSets: 0,
    machineSets: 0,
    cardioSets: 0,
    unknownSets: 0,
  };
  (Array.isArray(exercises) ? exercises : []).forEach((exercise) => {
    const recordedSets = (exercise.sets || []).filter(hasRecordedSetData);
    const completedSets = recordedSets.filter(isCompletedSet);
    const recordedKg = completedSets.reduce(
      (sum, set) => sum + getCompletedSetVolume(set),
      0,
    );
    const loadType = classifyExerciseLoad(exercise);
    total.recordedSets += recordedSets.length;
    total.completedSets += completedSets.length;
    total.incompleteSets += recordedSets.length - completedSets.length;
    if (loadType === "external") total.externalKg += recordedKg;
    else if (loadType === "machine") {
      total.machineKg += recordedKg;
      total.machineSets += completedSets.length;
    } else if (loadType === "assisted") {
      total.assistanceKg += recordedKg;
      total.assistedSets += completedSets.length;
    } else if (loadType === "bodyweight") {
      total.bodyweightSets += completedSets.length;
    } else if (loadType === "cardio") {
      total.cardioSets += completedSets.length;
    } else {
      total.unknownKg += recordedKg;
      total.unknownSets += completedSets.length;
    }
  });
  total.recordedKg = total.externalKg + total.machineKg + total.unknownKg;
  return total;
};
