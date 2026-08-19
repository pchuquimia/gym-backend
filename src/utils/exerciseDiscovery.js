const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const FAMILY_RULES = [
  {
    id: "leg-press",
    name: "Prensa de piernas",
    pattern: /\b(leg press|prensa de piernas?)\b/,
  },
  { id: "squat", name: "Sentadilla", pattern: /\b(squat|sentadill\w*)\b/ },
  {
    id: "deadlift",
    name: "Peso muerto",
    pattern: /\b(deadlift|peso muerto)\b/,
  },
  {
    id: "hip-thrust",
    name: "Empuje de cadera",
    pattern:
      /\b(hip thrust|glute bridge|puente de glute\w*|empuje de cadera)\b/,
  },
  { id: "lunge", name: "Zancada", pattern: /\b(lunge|zancad\w*|estocad\w*)\b/ },
  {
    id: "bench-press",
    name: "Press de pecho",
    pattern:
      /\b(bench press|chest press|press de banca|press banca|press de pecho)\b/,
  },
  {
    id: "shoulder-press",
    name: "Press de hombros",
    pattern:
      /\b(shoulder press|overhead press|military press|press militar|press de hombros?)\b/,
  },
  {
    id: "push-up",
    name: "Flexiones",
    pattern: /\b(push[ -]?ups?|flexiones?|lagartijas?)\b/,
  },
  {
    id: "pull-up",
    name: "Dominadas",
    pattern: /\b(pull[ -]?ups?|chin[ -]?ups?|dominadas?)\b/,
  },
  {
    id: "lat-pulldown",
    name: "Jalón al pecho",
    pattern: /\b(lat pulldown|pulldown|jalon(?:es)?(?: al pecho)?)\b/,
  },
  { id: "row", name: "Remo", pattern: /\b(rows?|remo(?:s)?)\b/ },
  {
    id: "lateral-raise",
    name: "Elevación lateral",
    pattern: /\b(lateral raises?|elevaciones? laterales?)\b/,
  },
  {
    id: "chest-fly",
    name: "Aperturas de pecho",
    pattern: /\b(chest fl(?:y|ies)|pec deck|aperturas?(?: de pecho)?)\b/,
  },
  {
    id: "biceps-curl",
    name: "Curl de bíceps",
    pattern: /\b(biceps? curls?|curl(?:es)? de biceps)\b/,
  },
  {
    id: "triceps-extension",
    name: "Extensión de tríceps",
    pattern:
      /\b(triceps? extensions?|pushdowns?|extension(?:es)? de triceps)\b/,
  },
  {
    id: "leg-extension",
    name: "Extensión de piernas",
    pattern:
      /\b(leg extensions?|extension(?:es)? de (?:piernas?|cuadriceps))\b/,
  },
  {
    id: "leg-curl",
    name: "Curl femoral",
    pattern: /\b(leg curls?|curl(?:es)? femoral(?:es)?)\b/,
  },
  {
    id: "calf-raise",
    name: "Elevación de talones",
    pattern: /\b(calf raises?|elevaciones? de talones?|pantorrillas?)\b/,
  },
  { id: "plank", name: "Plancha", pattern: /\b(planks?|planchas?)\b/ },
  {
    id: "crunch",
    name: "Abdominales",
    pattern: /\b(crunch(?:es)?|abdominales?)\b/,
  },
  {
    id: "running",
    name: "Carrera",
    pattern: /\b(running|treadmill|correr|carrera)\b/,
  },
];

const ADVANCED_PATTERN =
  /\b(unilateral|alternad\w*|incline|inclinado|decline|declinado|isometric|isometr\w*|pause|pausa|deficit|tempo|explosive|explosiv\w*|single arm|single leg|a una mano|a una pierna|behind the neck|tras nuca|smith|jm press|ez bar|agarre|grip|guillotine|palms|polea|cable|banda elastica|resistance band|amplio|cerrado|inverso)\b/;
const BEGINNER_PATTERN = /\b(beginner|principiante|basico|facil)\b/;

const exerciseText = (exercise = {}) =>
  normalizeText(
    [
      exercise.localizedNames?.es,
      exercise.localizedNames?.en,
      exercise.nameSpanish,
      exercise.nameEnglish,
      exercise.name,
      ...(Array.isArray(exercise.aliases) ? exercise.aliases : []),
    ]
      .filter(Boolean)
      .join(" "),
  );

export const findExerciseFamily = (exercise = {}) => {
  const explicit = exercise.discovery || {};
  if (explicit.familyId) {
    return {
      id: explicit.familyId,
      name: explicit.familyName || exercise.localizedNames?.es || exercise.name,
    };
  }
  const text = exerciseText(exercise);
  const rule = FAMILY_RULES.find(({ pattern }) => pattern.test(text));
  return rule ? { id: rule.id, name: rule.name } : null;
};

export const getExerciseDiscovery = (exercise = {}, query = "") => {
  const explicit = exercise.discovery || {};
  const family = findExerciseFamily(exercise);
  const text = exerciseText(exercise);
  const normalizedQuery = normalizeText(query);
  const advanced = ADVANCED_PATTERN.test(text);
  const beginner = BEGINNER_PATTERN.test(normalizeText(exercise.difficulty));
  const exactName = [
    exercise.localizedNames?.es,
    exercise.localizedNames?.en,
    exercise.nameSpanish,
    exercise.nameEnglish,
    exercise.name,
    ...(Array.isArray(exercise.aliases) ? exercise.aliases : []),
  ]
    .filter(Boolean)
    .some((name) => normalizeText(name) === normalizedQuery);
  const startsWithQuery = Boolean(
    normalizedQuery &&
    [exercise.localizedNames?.es, exercise.localizedNames?.en, exercise.name]
      .filter(Boolean)
      .some((name) => normalizeText(name).startsWith(normalizedQuery)),
  );
  const derivedEssential = Boolean(family && !advanced) || beginner;
  const isEssential =
    typeof explicit.isEssential === "boolean"
      ? explicit.isEssential
      : derivedEssential;
  const isPrimaryVariant =
    typeof explicit.isPrimaryVariant === "boolean"
      ? explicit.isPrimaryVariant
      : Boolean(family && !advanced);
  const priority = Number.isFinite(Number(explicit.priority))
    ? Number(explicit.priority)
    : 0;
  const score =
    priority * 10 +
    (exactName && normalizedQuery ? 1000 : 0) +
    (startsWithQuery ? 500 : 0) +
    (family ? 180 : 0) +
    (isEssential ? 80 : 0) +
    (beginner ? 30 : 0) -
    (advanced ? 90 : 0);

  return {
    familyId: family?.id || "",
    familyName: family?.name || "",
    isEssential,
    isPrimaryVariant,
    priority,
    score,
  };
};

const regexMatch = (field, regex) => ({
  $regexMatch: {
    input: { $ifNull: [field, ""] },
    regex,
    options: "i",
  },
});

const matchesAnyName = (regex) => ({
  $or: [
    regexMatch("$name", regex),
    regexMatch("$localizedNames.es", regex),
    regexMatch("$localizedNames.en", regex),
    regexMatch("$nameSpanish", regex),
    regexMatch("$nameEnglish", regex),
    {
      $anyElementTrue: {
        $map: {
          input: { $ifNull: ["$aliases", []] },
          as: "alias",
          in: regexMatch("$$alias", regex),
        },
      },
    },
  ],
});

const COMMON_FAMILY_REGEX =
  "(squat|sentadill|deadlift|peso\\s+muerto|bench\\s+press|press\\s+(de\\s+)?banca|chest\\s+press|press\\s+de\\s+pecho|shoulder\\s+press|press\\s+de\\s+hombro|push[ -]?up|flexion|pull[ -]?up|dominada|pulldown|jalon|lunge|zancad|hip\\s+thrust|puente\\s+de\\s+glute|row|remo|curl|plank|plancha|crunch|abdominal|leg\\s+press|prensa\\s+de\\s+pierna)";
const ADVANCED_REGEX =
  "(unilateral|alternad|incline|inclinado|decline|declinado|isometric|isometr|pause|pausa|deficit|tempo|explosive|explosiv|single\\s+(arm|leg)|a\\s+una\\s+(mano|pierna)|behind\\s+the\\s+neck|tras\\s+nuca|smith|jm\\s+press|ez\\s+bar|agarre|grip|guillotine|palms|polea|cable|banda\\s+elastica|resistance\\s+band|amplio|cerrado|inverso)";

export const buildExerciseDiscoveryScoreExpression = ({
  exactSearchPattern = "",
  prefixSearchPattern = "",
} = {}) => ({
  $add: [
    {
      $multiply: [
        {
          $convert: {
            input: { $ifNull: ["$discovery.priority", 0] },
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
        10,
      ],
    },
    exactSearchPattern
      ? { $cond: [matchesAnyName(exactSearchPattern), 1000, 0] }
      : 0,
    prefixSearchPattern
      ? { $cond: [matchesAnyName(prefixSearchPattern), 500, 0] }
      : 0,
    { $cond: [{ $eq: ["$discovery.isEssential", true] }, 260, 0] },
    { $cond: [matchesAnyName(COMMON_FAMILY_REGEX), 180, 0] },
    {
      $cond: [
        regexMatch("$difficulty", "(beginner|principiante|basico|facil)"),
        80,
        0,
      ],
    },
    { $cond: [matchesAnyName(ADVANCED_REGEX), -90, 0] },
  ],
});

export const decorateExerciseDiscovery = (exercise = {}, query = "") => ({
  ...exercise,
  discovery: {
    ...(exercise.discovery || {}),
    ...getExerciseDiscovery(exercise, query),
  },
});

export { normalizeText as normalizeDiscoveryText };
