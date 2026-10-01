const normalize = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("es")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const STOP_WORDS = new Set(["de", "del", "la", "las", "el", "los", "en", "con", "para", "por", "al", "a", "the", "and", "of", "on", "with"]);
const SYNONYM_GROUPS = [
  ["mancuerna", "mancuernas", "dumbbell", "dumbbells"],
  ["barra", "barbell"],
  ["polea", "poleas", "cable", "cables"],
  ["banda", "band", "resistencia"],
  ["pecho", "pectoral", "pectorales", "chest"],
  ["espalda", "dorsal", "dorsales", "back"],
  ["hombro", "hombros", "shoulder", "shoulders"],
  ["bicep", "biceps"],
  ["tricep", "triceps"],
  ["isquios", "isquiotibial", "isquiotibiales", "femoral", "femorales", "hamstring"],
  ["gluteo", "gluteos", "glute", "glutes"],
  ["cuadriceps", "quadriceps", "quad"],
  ["pantorrilla", "pantorrillas", "gemelo", "gemelos", "calf", "calves"],
  ["abdomen", "abdominal", "abdominales", "core"],
  ["sentadilla", "sentadillas", "squat", "squats"],
  ["remo", "remos", "row", "rows"],
  ["dominada", "dominadas", "pullup", "pullups"],
  ["jalon", "jalones", "pulldown"],
  ["flexion", "flexiones", "lagartija", "lagartijas", "pushup", "pushups"],
  ["zancada", "zancadas", "estocada", "estocadas", "lunge", "lunges"],
  ["elevacion", "elevaciones", "raise", "raises"],
  ["extension", "extensiones", "extension", "extensions"],
  ["press", "empuje"],
  ["inclinado", "inclinada", "incline"],
  ["declinado", "declinada", "decline"],
  ["militar", "military"],
  ["banca", "banco", "bench"],
  ["rumano", "rumana", "romanian"],
  ["sentado", "sentada", "seated"],
  ["acostado", "acostada", "lying"],
  ["unilateral", "solo", "single"],
];
const synonyms = new Map(SYNONYM_GROUPS.flatMap((group) => group.map((word) => [word, group])));
const QUERY_ALIASES = new Map([
  ["pesa", ["mancuerna", "mancuernas", "barra", "barbell", "dumbbell", "dumbbells", "kettlebell", "disco", "discos"]],
  ["pesas", ["mancuerna", "mancuernas", "barra", "barbell", "dumbbell", "dumbbells", "kettlebell", "disco", "discos"]],
  ["liga", ["banda", "band"]],
  ["ligas", ["banda", "band"]],
]);
const QUERY_PHRASE_ALIASES = [
  [/\bpeso muerto\b/g, "deadlift"],
  [/\bpress (?:de )?banca\b/g, "bench press"],
  [/\bprensa de piernas\b/g, "leg press"],
  [/\bempuje de cadera\b/g, "hip thrust"],
  [/\bjalon al pecho\b/g, "lat pulldown"],
];
const BASE_NAMES = new Set(["flexion de brazos", "flexiones de brazos", "flexiones", "sentadilla", "peso muerto", "press de banca", "curl de biceps", "remo", "jalon al pecho", "dominada", "dominadas", "elevacion de pantorrillas"]);
const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
const words = (value) => normalize(value).split(" ").filter(Boolean);

export const tokenizeExerciseQuery = (query) => words(query).filter((word) => !STOP_WORDS.has(word));

const withinOneEdit = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
};

const tokenMatch = (queryWord, candidateWord) => {
  if (queryWord === candidateWord) return 5;
  if (synonyms.get(queryWord)?.includes(candidateWord)) return 4;
  if (QUERY_ALIASES.get(queryWord)?.includes(candidateWord)) return 4;
  if (queryWord.length >= 3 && candidateWord.startsWith(queryWord)) return 3;
  const candidateForms = candidateWord.endsWith("s") ? [candidateWord, candidateWord.slice(0, -1)] : [candidateWord];
  if (queryWord.length >= 5 && candidateForms.some((form) => form.length >= 5 && withinOneEdit(queryWord, form))) return 2;
  return 0;
};

const textScore = (queryWords, value) => {
  const candidateWords = words(value).filter((word) => !STOP_WORDS.has(word));
  if (!candidateWords.length) return 0;
  const scores = queryWords.map((word) => Math.max(0, ...candidateWords.map((candidate) => tokenMatch(word, candidate))));
  return scores.every(Boolean) ? scores.reduce((sum, score) => sum + score, 0) : 0;
};

export const scoreExerciseSearch = (exercise, query) => {
  const alternatives = String(query || "").split("|").flatMap((term) => {
    const normalized = normalize(term);
    const translated = QUERY_PHRASE_ALIASES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), normalized);
    return [tokenizeExerciseQuery(normalized), ...(translated !== normalized ? [tokenizeExerciseQuery(translated)] : [])];
  }).filter((item) => item.length);
  if (!alternatives.length) return 0;
  const names = [exercise.localizedNames?.es, exercise.nameSpanish, exercise.name, exercise.localizedNames?.en, exercise.nameEnglish].filter(Boolean);
  const aliases = asArray(exercise.aliases);
  const metadata = [exercise.discovery?.familyName, ...asArray(exercise.discovery?.keywords), exercise.primaryMuscleGroup, exercise.muscle, exercise.primaryMuscle, ...asArray(exercise.primaryMuscles), ...asArray(exercise.equipment), ...asArray(exercise.categories), exercise.category].filter(Boolean);
  return Math.max(...alternatives.map((queryWords) => {
    const phrase = queryWords.join(" ");
    const allText = [...names, ...aliases, ...metadata].join(" ");
    if (queryWords.some((word) => word === "lagartija" || word === "lagartijas") &&
        !/(?:push[ -]?ups?|flexiones|flexion de brazos)/.test(normalize([...names, ...aliases].join(" ")))) return 0;
    if (!queryWords.every((word) => words(allText).some((candidate) => tokenMatch(word, candidate)))) return 0;
    const nameScore = Math.max(0, ...names.map((value) => {
      const score = textScore(queryWords, value);
      return score ? score + Math.max(0, 30 - words(value).length * 2) : 0;
    }));
    const aliasScore = Math.max(0, ...aliases.map((value) => textScore(queryWords, value)));
    const normalizedNames = names.map(normalize);
    const baseBonus = normalizedNames.some((value) => BASE_NAMES.has(value)) ? 100 : 0;
    if (normalizedNames.includes(phrase)) return 10000 + nameScore;
    if (normalizedNames.some((value) => value.startsWith(phrase))) return 8000 + nameScore;
    if (nameScore) return 6000 + nameScore + baseBonus;
    if (aliasScore) return 4000 + aliasScore;
    return 1000 + queryWords.reduce((sum, word) => sum + Math.max(0, ...words(allText).map((candidate) => tokenMatch(word, candidate))), 0);
  }));
};
