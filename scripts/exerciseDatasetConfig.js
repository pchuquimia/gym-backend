export const DATASET_PROVIDER = "hasaneyldrm";
export const DATASET_COMMIT =
  process.env.EXERCISES_DATASET_COMMIT ||
  "7455efae41b330c265e7cd4b78dfa848e7ce5ebd";
export const DATASET_BASE_URL = `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/${DATASET_COMMIT}`;
export const DATASET_JSON_URL = `${DATASET_BASE_URL}/data/exercises.json`;

const TARGET_MAP = {
  abs: ["Zona media", "Core", "Abdominales"],
  abductors: ["Tren inferior", "Piernas", "Abductores"],
  adductors: ["Tren inferior", "Piernas", "Aductores"],
  biceps: ["Tren superior", "Brazos", "Bíceps"],
  calves: ["Tren inferior", "Piernas", "Pantorrillas"],
  "cardiovascular system": [
    "Cuerpo completo",
    "Cuerpo completo",
    "Ejercicios metabólicos",
  ],
  delts: ["Tren superior", "Hombros", "Hombros"],
  forearms: ["Tren superior", "Brazos", "Antebrazos"],
  glutes: ["Tren inferior", "Glúteos", "Glúteos"],
  hamstrings: ["Tren inferior", "Piernas", "Isquiotibiales"],
  lats: ["Tren superior", "Espalda", "Espalda"],
  "levator scapulae": ["Tren superior", "Espalda", "Espalda"],
  pectorals: ["Tren superior", "Pecho", "Pecho"],
  quads: ["Tren inferior", "Piernas", "Cuádriceps"],
  "serratus anterior": ["Tren superior", "Pecho", "Pecho"],
  spine: ["Zona media", "Core", "Erectores espinales"],
  traps: ["Tren superior", "Espalda", "Espalda"],
  triceps: ["Tren superior", "Brazos", "Tríceps"],
  "upper back": ["Tren superior", "Espalda", "Espalda"],
};

const EQUIPMENT_MAP = {
  assisted: "Máquina",
  band: "Banda elástica",
  barbell: "Barra",
  "body weight": "Peso corporal",
  "bosu ball": "Bosu",
  cable: "Polea",
  dumbbell: "Mancuernas",
  "elliptical machine": "Elíptica",
  "ez barbell": "Barra",
  hammer: "Sin equipamiento",
  kettlebell: "Kettlebell",
  "leverage machine": "Máquina",
  "medicine ball": "Balón medicinal",
  "olympic barbell": "Barra",
  "resistance band": "Banda elástica",
  roller: "Sin equipamiento",
  rope: "Cuerda",
  "skierg machine": "Máquina",
  "sled machine": "Trineo",
  "smith machine": "Máquina Smith",
  "stability ball": "Fitball",
  "stationary bike": "Bicicleta",
  "stepmill machine": "Escaladora",
  tire: "Sin equipamiento",
  "trap bar": "Barra",
  "upper body ergometer": "Máquina",
  weighted: "Discos",
  "wheel roller": "Sin equipamiento",
};

const unique = (values = []) =>
  [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];

const slugify = (value = "") =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

export const fetchDataset = async () => {
  const response = await fetch(DATASET_JSON_URL, {
    headers: { "User-Agent": "gym-exercise-importer" },
  });
  if (!response.ok) {
    throw new Error(`Dataset download failed (${response.status})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Dataset response is not an array");
  return rows;
};

export const getDatasetExerciseId = (externalId) =>
  `dataset-hasane-${String(externalId).padStart(4, "0")}`;

export const toDatasetExercise = (row, now = new Date()) => {
  const target = String(row.target || "").trim().toLowerCase();
  const [bodyRegion, navigationRegion, primaryMuscleGroup] = TARGET_MAP[
    target
  ] || ["Cuerpo completo", "Cuerpo completo", "Full body"];
  const isCardio = target === "cardiovascular system";
  const category = isCardio ? "Cardio" : "Fuerza e hipertrofia";
  const equipment = EQUIPMENT_MAP[row.equipment] || row.equipment || "";
  const externalId = String(row.id || "").trim();
  const id = getDatasetExerciseId(externalId);
  const instructions = row.instruction_steps?.es?.length
    ? row.instruction_steps.es
    : row.instruction_steps?.en || [];
  const primaryMuscles = unique([row.muscle_group, row.target]);
  const secondaryMuscles = unique(row.secondary_muscles);

  return {
    _id: id,
    slug: id,
    name: String(row.name || "").trim(),
    aliases: [],
    category,
    categories: [category],
    bodyRegion,
    navigationRegion,
    primaryMuscleGroup,
    muscle: primaryMuscleGroup,
    primaryMuscle: primaryMuscleGroup,
    primaryMuscles,
    secondaryMuscles,
    stabilizerMuscles: [],
    description: row.instructions?.es || row.instructions?.en || "",
    instructions,
    commonMistakes: [],
    movementPattern: "",
    movementPatterns: [],
    equipment: unique([equipment]),
    exerciseType: "",
    laterality: "",
    kineticChain: "",
    executionType: "Dinámico",
    stability: "",
    position: "",
    difficulty: "",
    goals: isCardio
      ? ["Acondicionamiento cardiovascular"]
      : ["Fuerza máxima", "Hipertrofia"],
    mechanics: { forceType: "", contraction: "Dinámico" },
    force: isCardio ? "" : "",
    precautions: [],
    branches: ["general"],
    tags: unique([
      row.category,
      row.body_part,
      row.target,
      row.muscle_group,
      row.equipment,
    ]),
    type: "system",
    ownerId: null,
    isActive: true,
    version: 1,
    createdBy: "hasaneyldrm_import",
    updatedBy: "hasaneyldrm_import",
    classificationStatus: TARGET_MAP[target] ? "mapped" : "review",
    source: {
      provider: DATASET_PROVIDER,
      externalId,
      mediaId: String(row.media_id || ""),
      datasetCommit: DATASET_COMMIT,
      imagePath: String(row.image || ""),
      animationPath: String(row.gif_url || ""),
      attribution: String(row.attribution || ""),
      importedAt: now,
      lastSyncedAt: now,
    },
  };
};

export const summarizeDataset = (exercises) => ({
  total: exercises.length,
  byCategory: exercises.reduce((result, exercise) => {
    result[exercise.category] = (result[exercise.category] || 0) + 1;
    return result;
  }, {}),
  byRegion: exercises.reduce((result, exercise) => {
    result[exercise.bodyRegion] = (result[exercise.bodyRegion] || 0) + 1;
    return result;
  }, {}),
  requiresReview: exercises.filter(
    (exercise) => exercise.classificationStatus === "review",
  ).length,
});

export { slugify };
