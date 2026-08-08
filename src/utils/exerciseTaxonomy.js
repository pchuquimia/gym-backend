export const TAXONOMY_VERSION = 2;

export const EXERCISE_CATEGORIES = [
  "Fuerza e hipertrofia",
  "Cardio",
  "Movilidad",
  "Activación",
  "Estabilidad",
  "Pliometría",
];

export const BODY_REGION_GROUPS = {
  "Tren superior": [
    "Pecho",
    "Espalda",
    "Hombros",
    "Bíceps",
    "Tríceps",
    "Antebrazos",
  ],
  "Tren inferior": [
    "Cuádriceps",
    "Isquiotibiales",
    "Glúteos",
    "Aductores",
    "Abductores",
    "Pantorrillas",
    "Tibial anterior",
  ],
  "Zona media": [
    "Abdominales",
    "Oblicuos",
    "Transverso abdominal",
    "Erectores espinales",
    "Core global",
  ],
  "Cuerpo completo": [
    "Full body",
    "Levantamientos olímpicos",
    "Ejercicios metabólicos",
    "Movimientos combinados",
  ],
};

const NAVIGATION_GROUPS = {
  Pecho: ["Pecho"],
  Espalda: ["Espalda"],
  Hombros: ["Hombros"],
  Brazos: ["Bíceps", "Tríceps", "Antebrazos"],
  Piernas: [
    "Cuádriceps",
    "Isquiotibiales",
    "Aductores",
    "Abductores",
    "Pantorrillas",
    "Tibial anterior",
  ],
  Glúteos: ["Glúteos"],
  Core: [
    "Abdominales",
    "Oblicuos",
    "Transverso abdominal",
    "Erectores espinales",
    "Core global",
  ],
  "Cuerpo completo": [
    "Full body",
    "Levantamientos olímpicos",
    "Ejercicios metabólicos",
    "Movimientos combinados",
  ],
};

export const MOVEMENT_PATTERNS = [
  "Empuje horizontal",
  "Empuje vertical",
  "Tracción horizontal",
  "Tracción vertical",
  "Flexión de codo",
  "Extensión de codo",
  "Elevación de hombro",
  "Abducción de hombro",
  "Rotación interna",
  "Rotación externa",
  "Retracción escapular",
  "Protracción escapular",
  "Dominante de rodilla",
  "Dominante de cadera",
  "Sentadilla",
  "Bisagra de cadera",
  "Zancada",
  "Extensión de cadera",
  "Flexión de rodilla",
  "Extensión de rodilla",
  "Abducción de cadera",
  "Aducción de cadera",
  "Flexión plantar",
  "Dorsiflexión",
  "Flexión de tronco",
  "Extensión de tronco",
  "Rotación",
  "Anti-rotación",
  "Anti-extensión",
  "Anti-flexión lateral",
  "Estabilización lumbo-pélvica",
  "Transporte de cargas",
  "Empujar",
  "Jalar",
  "Cargar",
  "Transportar",
  "Lanzar",
  "Saltar",
  "Correr",
  "Trepar",
  "Arrastrar",
];

export const EQUIPMENT_OPTIONS = [
  "Peso corporal",
  "Barra",
  "Mancuernas",
  "Discos",
  "Kettlebell",
  "Polea",
  "Máquina",
  "Máquina Smith",
  "Banda elástica",
  "TRX o suspensión",
  "Balón medicinal",
  "Fitball",
  "Bosu",
  "Cajón",
  "Banco",
  "Landmine",
  "Trineo",
  "Cuerda",
  "Barra de dominadas",
  "Paralelas",
  "Caminadora",
  "Bicicleta",
  "Elíptica",
  "Remo ergómetro",
  "Escaladora",
  "Sin equipamiento",
];

export const EXERCISE_TYPE_OPTIONS = [
  "Monoarticular o aislamiento",
  "Multiarticular o compuesto",
];
export const LATERALITY_OPTIONS = ["Bilateral", "Unilateral", "Alternado"];
export const KINETIC_CHAIN_OPTIONS = [
  "Cadena cinética abierta",
  "Cadena cinética cerrada",
  "Mixta",
];
export const EXECUTION_TYPE_OPTIONS = [
  "Dinámico",
  "Isométrico",
  "Isocinético",
  "Excéntrico",
  "Concéntrico",
  "Reactivo",
  "Balístico",
];
export const STABILITY_OPTIONS = [
  "Estable",
  "Inestable",
  "Guiado por máquina",
  "Peso libre",
];
export const POSITION_OPTIONS = [
  "De pie",
  "Sentado",
  "Acostado en supino",
  "Acostado en prono",
  "Decúbito lateral",
  "Cuadrupedia",
  "Arrodillado",
  "Medio arrodillado",
  "Suspendido",
  "Inclinado",
  "Declinado",
  "Apoyado en banco",
  "En máquina",
];
export const DIFFICULTY_OPTIONS = ["Principiante", "Intermedio", "Avanzado"];
export const GOAL_OPTIONS = [
  "Fuerza máxima",
  "Hipertrofia",
  "Resistencia muscular",
  "Potencia",
  "Velocidad",
  "Acondicionamiento cardiovascular",
  "Pérdida de grasa",
  "Activación",
  "Movilidad",
  "Estabilidad",
  "Coordinación",
  "Equilibrio",
  "Rehabilitación",
  "Técnica",
  "Prevención de lesiones",
];

export const normalizeTaxonomyKey = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const optionMap = (options) =>
  new Map(options.map((option) => [normalizeTaxonomyKey(option), option]));
const groupOptions = Object.values(BODY_REGION_GROUPS).flat();
const bodyRegionMap = optionMap(Object.keys(BODY_REGION_GROUPS));
const groupMap = optionMap(groupOptions);
const categoryMap = optionMap(EXERCISE_CATEGORIES);
const patternMap = optionMap(MOVEMENT_PATTERNS);
const equipmentMap = optionMap(EQUIPMENT_OPTIONS);
const exerciseTypeMap = optionMap(EXERCISE_TYPE_OPTIONS);
const lateralityMap = optionMap(LATERALITY_OPTIONS);
const kineticChainMap = optionMap(KINETIC_CHAIN_OPTIONS);
const executionTypeMap = optionMap(EXECUTION_TYPE_OPTIONS);
const stabilityMap = optionMap(STABILITY_OPTIONS);
const positionMap = optionMap(POSITION_OPTIONS);
const difficultyMap = optionMap(DIFFICULTY_OPTIONS);
const goalMap = optionMap(GOAL_OPTIONS);

const aliases = (entries) => new Map(
  Object.entries(entries).map(([key, value]) => [normalizeTaxonomyKey(key), value]),
);
const groupAliases = aliases({
  biceps: "Bíceps",
  triceps: "Tríceps",
  cuadricep: "Cuádriceps",
  cuadriceps: "Cuádriceps",
  femoral: "Isquiotibiales",
  femorales: "Isquiotibiales",
  isquios: "Isquiotibiales",
  gluteo: "Glúteos",
  gluteos: "Glúteos",
  abdomen: "Abdominales",
  core: "Core global",
  "cuerpo completo": "Full body",
});
const equipmentAliases = aliases({
  maquina: "Máquina",
  dumbbell: "Mancuernas",
  barbell: "Barra",
  cable: "Polea",
  "body weight": "Peso corporal",
  "ez barbell": "Barra",
  "leverage machine": "Máquina",
  "smith machine": "Máquina Smith",
  band: "Banda elástica",
  "resistance band": "Banda elástica",
  "stability ball": "Fitball",
  weighted: "Discos",
  assisted: "Máquina",
  "medicine ball": "Balón medicinal",
  "sled machine": "Trineo",
  "olympic barbell": "Barra",
  "bodyweight": "Peso corporal",
});

const canonical = (value, map, aliasMap = null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = normalizeTaxonomyKey(raw);
  return map.get(key) || aliasMap?.get(key) || raw;
};
const unique = (items = []) => [...new Set(items.filter(Boolean))];
const asArray = (value) =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter(Boolean);

export const canonicalizeMuscleGroup = (value) =>
  canonical(value, groupMap, groupAliases);
export const canonicalizeBodyRegion = (value) =>
  canonical(value, bodyRegionMap);
export const canonicalizeCategory = (value) => canonical(value, categoryMap);
export const canonicalizeMovementPattern = (value) => canonical(value, patternMap);
export const canonicalizeEquipment = (value) =>
  canonical(value, equipmentMap, equipmentAliases);

export const getBodyRegionForGroup = (value) => {
  const group = canonicalizeMuscleGroup(value);
  return Object.entries(BODY_REGION_GROUPS).find(([, groups]) =>
    groups.includes(group),
  )?.[0] || "";
};
export const getNavigationRegionForGroup = (value) => {
  const group = canonicalizeMuscleGroup(value);
  return Object.entries(NAVIGATION_GROUPS).find(([, groups]) =>
    groups.includes(group),
  )?.[0] || group;
};

const textFor = (exercise) => normalizeTaxonomyKey([
  exercise.name,
  exercise.localizedNames?.es,
  exercise.localizedNames?.en,
  ...asArray(exercise.aliases),
  ...asArray(exercise.tags),
].filter(Boolean).join(" "));
const hasAny = (text, terms) => terms.some((term) => text.includes(term));

const inferCategory = (exercise, text, group) => {
  const existing = canonicalizeCategory(
    exercise.category || asArray(exercise.categories)[0],
  );
  const shouldInferFromDataset = exercise.source?.provider === "hasaneyldrm";
  if (existing && !shouldInferFromDataset) return existing;
  if (group === "Ejercicios metabólicos" || hasAny(text, ["cardio", "treadmill", "elliptical", "stepmill", "stationary bike", "sprint"])) return "Cardio";
  if (hasAny(text, ["stretch", "estiramiento", "mobility", "movilidad"])) return "Movilidad";
  if (hasAny(text, ["activation", "activacion", "warm up", "calentamiento"])) return "Activación";
  if (hasAny(text, ["jump", "salto", "plyo", "hop", "bound"])) return "Pliometría";
  if (hasAny(text, ["isometric", "isometrico", "plank", "plancha", "stabilization", "equilibrio"])) return "Estabilidad";
  return existing || "Fuerza e hipertrofia";
};

const inferPattern = (text, group) => {
  if (group === "Pecho") return "Empuje horizontal";
  if (group === "Hombros") {
    if (hasAny(text, ["lateral raise", "elevacion lateral"])) return "Abducción de hombro";
    if (hasAny(text, ["front raise", "elevacion frontal", "shrug", "encogimiento"])) return "Elevación de hombro";
    if (hasAny(text, ["external rotation", "rotacion externa"])) return "Rotación externa";
    if (hasAny(text, ["internal rotation", "rotacion interna"])) return "Rotación interna";
    return "Empuje vertical";
  }
  if (group === "Espalda") return hasAny(text, ["pull up", "pull-up", "pulldown", "dominada", "jalon"]) ? "Tracción vertical" : "Tracción horizontal";
  if (group === "Bíceps" || group === "Antebrazos") return "Flexión de codo";
  if (group === "Tríceps") return "Extensión de codo";
  if (group === "Cuádriceps") {
    if (hasAny(text, ["lunge", "zancada", "split squat"])) return "Zancada";
    if (hasAny(text, ["extension", "extension"])) return "Extensión de rodilla";
    return hasAny(text, ["squat", "sentadilla"]) ? "Sentadilla" : "Dominante de rodilla";
  }
  if (group === "Isquiotibiales") return hasAny(text, ["curl", "flexion"]) ? "Flexión de rodilla" : "Bisagra de cadera";
  if (group === "Glúteos") {
    if (hasAny(text, ["abduction", "abduccion", "side", "lateral"])) return "Abducción de cadera";
    return hasAny(text, ["lunge", "zancada"]) ? "Zancada" : "Extensión de cadera";
  }
  if (group === "Aductores") return "Aducción de cadera";
  if (group === "Abductores") return "Abducción de cadera";
  if (group === "Pantorrillas") return hasAny(text, ["reverse", "inverso", "tibial"]) ? "Dorsiflexión" : "Flexión plantar";
  if (group === "Tibial anterior") return "Dorsiflexión";
  if (group === "Oblicuos") return hasAny(text, ["pallof", "anti rotation"]) ? "Anti-rotación" : "Rotación";
  if (group === "Erectores espinales") return "Extensión de tronco";
  if (group === "Core global") return "Estabilización lumbo-pélvica";
  if (group === "Abdominales") return hasAny(text, ["plank", "plancha", "rollout", "wheel"]) ? "Anti-extensión" : "Flexión de tronco";
  if (group === "Ejercicios metabólicos") return hasAny(text, ["sled", "trineo", "drag", "arrastre"]) ? "Arrastrar" : "Correr";
  if (group === "Levantamientos olímpicos") return "Cargar";
  return "Empujar";
};

const inferExerciseType = (text, group) => {
  const isolationGroups = ["Bíceps", "Tríceps", "Antebrazos", "Aductores", "Abductores", "Pantorrillas", "Tibial anterior"];
  if (isolationGroups.includes(group) || hasAny(text, ["curl", "raise", "elevacion", "extension", "fly", "apertura", "adduction", "abduction"])) return "Monoarticular o aislamiento";
  return "Multiarticular o compuesto";
};

const inferLaterality = (text) => {
  if (hasAny(text, ["alternating", "alternado", "alternating"])) return "Alternado";
  if (hasAny(text, ["one arm", "one-arm", "one leg", "one-leg", "single", "unilateral", "un brazo", "una pierna"])) return "Unilateral";
  return "Bilateral";
};

const inferPosition = (text, group, equipment) => {
  if (hasAny(text, ["half kneeling", "medio arrodillado"])) return "Medio arrodillado";
  if (hasAny(text, ["kneeling", "arrodillado"])) return "Arrodillado";
  if (hasAny(text, ["quadruped", "all fours", "cuadrupedia"])) return "Cuadrupedia";
  if (hasAny(text, ["side lying", "lateral acostado", "decubito lateral"])) return "Decúbito lateral";
  if (hasAny(text, ["prone", "boca abajo"])) return "Acostado en prono";
  if (hasAny(text, ["decline", "declinado"])) return "Declinado";
  if (hasAny(text, ["incline", "inclinado"])) return "Inclinado";
  if (hasAny(text, ["supine", "lying", "acostado", "bench press"])) return "Acostado en supino";
  if (hasAny(text, ["seated", "sentado"])) return "Sentado";
  if (hasAny(text, ["pull up", "pull-up", "hanging", "suspendido"])) return "Suspendido";
  if (equipment.includes("Máquina") || equipment.includes("Máquina Smith")) return "En máquina";
  if (["Abdominales", "Oblicuos"].includes(group)) return "Acostado en supino";
  return "De pie";
};

const inferGoals = (category) => {
  if (category === "Cardio") return ["Acondicionamiento cardiovascular", "Resistencia muscular"];
  if (category === "Movilidad") return ["Movilidad", "Prevención de lesiones"];
  if (category === "Activación") return ["Activación", "Prevención de lesiones"];
  if (category === "Estabilidad") return ["Estabilidad", "Coordinación"];
  if (category === "Pliometría") return ["Potencia", "Velocidad", "Coordinación"];
  return ["Fuerza máxima", "Hipertrofia"];
};

export const classifyExerciseTaxonomy = (exercise = {}) => {
  const text = textFor(exercise);
  const group = canonicalizeMuscleGroup(
    exercise.primaryMuscleGroup || exercise.primaryMuscle || exercise.muscle,
  );
  const bodyRegion = getBodyRegionForGroup(group) || canonicalizeBodyRegion(exercise.bodyRegion);
  const equipment = unique(asArray(exercise.equipment).map(canonicalizeEquipment));
  const category = inferCategory(exercise, text, group);
  const movementPattern = canonicalizeMovementPattern(
    exercise.movementPattern || asArray(exercise.movementPatterns)[0],
  ) || inferPattern(text, group);
  const exerciseType = canonical(
    exercise.exerciseType,
    exerciseTypeMap,
  ) || inferExerciseType(text, group);
  const laterality = canonical(exercise.laterality, lateralityMap) || inferLaterality(text);
  const executionType = canonical(exercise.executionType, executionTypeMap) || (hasAny(text, ["isometric", "isometrico", "hold", "plank", "plancha"]) ? "Isométrico" : category === "Pliometría" ? "Reactivo" : "Dinámico");
  const position = canonical(exercise.position, positionMap) || inferPosition(text, group, equipment);
  const kineticChain = canonical(exercise.kineticChain, kineticChainMap) || (category === "Cardio" ? "Mixta" : equipment.includes("Peso corporal") ? "Cadena cinética cerrada" : "Cadena cinética abierta");
  const stability = canonical(exercise.stability, stabilityMap) || (equipment.some((item) => ["Máquina", "Máquina Smith"].includes(item)) ? "Guiado por máquina" : equipment.some((item) => ["Fitball", "Bosu", "TRX o suspensión"].includes(item)) ? "Inestable" : equipment.some((item) => ["Barra", "Mancuernas", "Kettlebell", "Discos"].includes(item)) ? "Peso libre" : "Estable");
  const difficulty = canonical(exercise.difficulty, difficultyMap) || (equipment.includes("Máquina") || equipment.includes("Máquina Smith") || category === "Movilidad" ? "Principiante" : category === "Pliometría" || hasAny(text, ["olympic", "snatch", "clean and jerk", "muscle up"]) ? "Avanzado" : "Intermedio");
  const goals = unique(asArray(exercise.goals).map((goal) => canonical(goal, goalMap)).filter((goal) => goalMap.has(normalizeTaxonomyKey(goal))));
  const inheritedCategories =
    exercise.source?.provider === "hasaneyldrm"
      ? []
      : asArray(exercise.categories)
          .map(canonicalizeCategory)
          .filter((item) => categoryMap.has(normalizeTaxonomyKey(item)));

  return {
    category,
    categories: unique([category, ...inheritedCategories]),
    bodyRegion,
    navigationRegion: getNavigationRegionForGroup(group),
    primaryMuscleGroup: group,
    muscle: group,
    primaryMuscle: group,
    movementPattern,
    movementPatterns: unique([movementPattern]),
    equipment,
    exerciseType,
    laterality,
    kineticChain,
    executionType,
    stability,
    position,
    difficulty,
    goals: goals.length ? goals : inferGoals(category),
    movementMode: laterality === "Unilateral" ? "unilateral" : "bilateral",
    supportsUnilateral: exercise.supportsUnilateral || laterality === "Unilateral",
    taxonomyVersion: TAXONOMY_VERSION,
  };
};

const slugify = (value = "") => normalizeTaxonomyKey(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const buildExerciseIdentityKey = (exercise = {}) => {
  const taxonomy = classifyExerciseTaxonomy(exercise);
  return [
    exercise.localizedNames?.en || exercise.name,
    taxonomy.primaryMuscleGroup,
    taxonomy.equipment.join("+"),
    taxonomy.laterality,
    taxonomy.position,
  ].map(slugify).filter(Boolean).join("__");
};
