import Exercise from "../models/Exercise.js";

const EXACT_SPANISH_NAMES = new Map([
  ["3/4 sit-up", "Abdominal 3/4"],
  ["air bike", "Bicicleta de aire"],
  ["archer pull up", "Dominada arquero"],
  ["archer push up", "Flexion arquero"],
  ["back lever", "Palanca dorsal"],
  ["barbell bench press", "Press de banca con barra"],
  ["barbell deadlift", "Peso muerto con barra"],
  ["barbell front squat", "Sentadilla frontal con barra"],
  ["barbell full squat", "Sentadilla profunda con barra"],
  ["barbell good morning", "Buenos dias con barra"],
  ["barbell incline bench press", "Press inclinado con barra"],
  ["barbell lunge", "Zancada con barra"],
  ["barbell overhead squat", "Sentadilla sobre la cabeza con barra"],
  ["barbell pendlay row", "Remo Pendlay con barra"],
  ["bodyweight squat", "Sentadilla con peso corporal"],
  ["burpee", "Burpee"],
  ["chin-up", "Dominada supina"],
  ["dead bug", "Bicho muerto"],
  ["farmer's walk", "Caminata del granjero"],
  ["front plank", "Plancha frontal"],
  ["jumping jack", "Salto de tijera"],
  ["mountain climber", "Escalador"],
  ["pull-up", "Dominada"],
  ["push-up", "Flexion de brazos"],
  ["romanian deadlift", "Peso muerto rumano"],
  ["russian twist", "Giro ruso"],
  ["side plank", "Plancha lateral"],
]);

const EQUIPMENT_PREFIXES = [
  ["smith machine ", "maquina Smith"],
  ["leverage machine ", "maquina de palanca"],
  ["assisted machine ", "maquina asistida"],
  ["cable ", "polea"],
  ["barbell ", "barra"],
  ["dumbbell ", "mancuernas"],
  ["kettlebell ", "kettlebell"],
  ["band ", "banda elastica"],
  ["medicine ball ", "balon medicinal"],
  ["stability ball ", "fitball"],
  ["weighted ", "lastre"],
];

const PHRASE_TRANSLATIONS = [
  ["close grip", "agarre cerrado"],
  ["close-grip", "agarre cerrado"],
  ["wide grip", "agarre amplio"],
  ["wide-grip", "agarre amplio"],
  ["reverse grip", "agarre inverso"],
  ["reverse-grip", "agarre inverso"],
  ["underhand grip", "agarre supino"],
  ["overhand grip", "agarre prono"],
  ["single leg", "una pierna"],
  ["one leg", "una pierna"],
  ["single arm", "un brazo"],
  ["one arm", "un brazo"],
  ["two arms", "dos brazos"],
  ["two legs", "dos piernas"],
  ["bent over", "inclinado"],
  ["straight leg", "piernas rectas"],
  ["stiff leg", "piernas rigidas"],
  ["behind the neck", "tras nuca"],
  ["overhead", "sobre la cabeza"],
  ["rear delt", "deltoide posterior"],
  ["front raise", "elevacion frontal"],
  ["lateral raise", "elevacion lateral"],
  ["calf raise", "elevacion de pantorrillas"],
  ["heel raise", "elevacion de talones"],
  ["leg raise", "elevacion de piernas"],
  ["knee raise", "elevacion de rodillas"],
  ["hip raise", "elevacion de cadera"],
  ["hip extension", "extension de cadera"],
  ["hip thrust", "empuje de cadera"],
  ["triceps extension", "extension de triceps"],
  ["leg extension", "extension de piernas"],
  ["back extension", "extension lumbar"],
  ["shoulder press", "press de hombros"],
  ["chest press", "press de pecho"],
  ["bench press", "press de banca"],
  ["military press", "press militar"],
  ["push press", "push press"],
  ["pull up", "dominada"],
  ["pull-up", "dominada"],
  ["chin up", "dominada supina"],
  ["chin-up", "dominada supina"],
  ["push up", "flexion de brazos"],
  ["push-up", "flexion de brazos"],
  ["lat pulldown", "jalon al pecho"],
  ["pulldown", "jalon"],
  ["pull through", "pull through"],
  ["wheel rollout", "rueda abdominal"],
  ["throw down", "lanzamiento hacia abajo"],
  ["toe touch", "toque de pies"],
  ["floor press", "press en el suelo"],
  ["rack pull", "peso muerto desde soportes"],
  ["arm blaster", "soporte para brazos"],
  ["arms apart", "brazos separados"],
  ["arm slingers", "balanceo de brazos"],
  ["side bend", "flexion lateral"],
  ["deadlift", "peso muerto"],
  ["split squat", "sentadilla dividida"],
  ["hack squat", "sentadilla hack"],
  ["jump squat", "sentadilla con salto"],
  ["front squat", "sentadilla frontal"],
  ["sissy squat", "sentadilla sissy"],
  ["squat", "sentadilla"],
  ["lateral lunge", "zancada lateral"],
  ["reverse lunge", "zancada inversa"],
  ["walking lunge", "zancada caminando"],
  ["lunge", "zancada"],
  ["step up", "subida al cajon"],
  ["step-up", "subida al cajon"],
  ["glute bridge", "puente de gluteos"],
  ["good morning", "buenos dias"],
  ["preacher curl", "curl predicador"],
  ["hammer curl", "curl martillo"],
  ["concentration curl", "curl de concentracion"],
  ["wrist curl", "curl de muneca"],
  ["biceps curl", "curl de biceps"],
  ["leg curl", "curl femoral"],
  ["skull crusher", "rompecraneos"],
  ["upright row", "remo al menton"],
  ["seated row", "remo sentado"],
  ["low row", "remo bajo"],
  ["high row", "remo alto"],
  ["row", "remo"],
  ["reverse fly", "aperturas inversas"],
  ["chest fly", "aperturas de pecho"],
  ["fly", "aperturas"],
  ["chest dip", "fondos para pecho"],
  ["triceps dip", "fondos para triceps"],
  ["dip", "fondos"],
  ["sit up", "abdominal"],
  ["sit-up", "abdominal"],
  ["crunch", "encogimiento abdominal"],
  ["v-up", "abdominal en V"],
  ["plank", "plancha"],
  ["twist", "giro"],
  ["rotation", "rotacion"],
  ["adduction", "aduccion"],
  ["abduction", "abduccion"],
  ["internal rotation", "rotacion interna"],
  ["external rotation", "rotacion externa"],
  ["shrug", "encogimiento de hombros"],
  ["pullover", "pullover"],
  ["clean and press", "cargada y press"],
  ["clean", "cargada"],
  ["snatch", "arrancada"],
  ["stretch", "estiramiento"],
  ["assisted", "asistido"],
  ["alternating", "alterno"],
  ["alternate", "alterno"],
  ["reverse", "inverso"],
  ["incline", "inclinado"],
  ["decline", "declinado"],
  ["lying", "acostado"],
  ["seated", "sentado"],
  ["standing", "de pie"],
  ["kneeling", "arrodillado"],
  ["prone", "boca abajo"],
  ["hanging", "colgado"],
  ["twisting", "con giro"],
  ["bent", "flexionado"],
  ["straight", "recto"],
  ["arms", "brazos"],
  ["legs", "piernas"],
  ["palms down", "palmas hacia abajo"],
  ["palms up", "palmas hacia arriba"],
  ["over head", "sobre la cabeza"],
  ["behind head", "tras nuca"],
  ["exercise ball", "fitball"],
  ["stability ball", "fitball"],
  ["on floor", "en el suelo"],
  ["on bench", "en banco"],
  ["on the wall", "contra la pared"],
  ["on exercise ball", "en fitball"],
  ["on stability ball", "en fitball"],
  ["above head", "sobre la cabeza"],
  ["behind neck", "tras nuca"],
  ["of the head", "de la cabeza"],
  ["skull press", "press rompecráneos"],
  ["french press", "press francés"],
  ["hammer press", "press martillo"],
  ["russian twists", "giros rusos"],
  ["kickbacks", "patada de tríceps"],
  ["bicep curl", "curl de bíceps"],
  ["tennis ball", "pelota de tenis"],
  ["hang position", "posición colgada"],
  ["bottoms up", "invertido"],
  ["support head", "cabeza apoyada"],
  ["point stance", "puntos de apoyo"],
  ["muscle-up", "muscle-up"],
  ["rollerout", "rueda abdominal"],
  ["lifting", "elevación"],
  ["concentration", "concentración"],
  ["modified", "modificada"],
  ["supine", "supino"],
  ["rear", "posterior"],
  ["raised", "elevada"],
  ["elbow", "codo"],
  ["knees", "rodillas"],
  ["ankles", "tobillos"],
  ["machine", "máquina"],
  ["lever", "máquina de palanca"],
  ["cage", "estructura"],
  ["catch", "recepción"],
  ["throw", "lanzamiento"],
  ["stance", "posición"],
  ["wide", "amplio"],
  ["two", "dos"],
  ["lower", "bajar"],
  ["between", "entre"],
  ["from", "desde"],
  ["with", "con"],
  ["of", "de"],
  ["the", "la"],
  ["on", "en"],
  ["to", "a"],
  ["both", "ambos"],
  ["with", "con"],
  ["and", "y"],
  ["over", "sobre"],
  ["under", "debajo de"],
  ["floor", "suelo"],
  ["bench", "banco"],
  ["ball", "balon"],
  ["towel", "toalla"],
  ["male", "hombre"],
  ["female", "mujer"],
  ["full", "completo"],
  ["side", "lateral"],
  ["front", "frontal"],
  ["back", "espalda"],
  ["down", "abajo"],
  ["up", "arriba"],
  ["step", "paso"],
  ["grip", "agarre"],
  ["horizontal", "horizontal"],
  ["vertical", "vertical"],
  ["backward", "hacia atras"],
  ["forward", "hacia adelante"],
  ["lateral", "lateral"],
  ["biceps", "biceps"],
  ["triceps", "triceps"],
  ["hamstring", "isquiotibiales"],
  ["quadriceps", "cuadriceps"],
  ["quads", "cuadriceps"],
  ["gluteus", "gluteo"],
  ["glutes", "gluteos"],
  ["calves", "pantorrillas"],
  ["chest", "pecho"],
  ["shoulder", "hombro"],
  ["back", "espalda"],
  ["wrist", "muneca"],
  ["neck", "cuello"],
  ["ankle", "tobillo"],
  ["knee", "rodilla"],
  ["hip", "cadera"],
  ["arm", "brazo"],
  ["leg", "pierna"],
  ["jump", "salto"],
  ["raise", "elevacion"],
  ["extension", "extension"],
  ["flexion", "flexion"],
  ["press", "press"],
  ["curl", "curl"],
];

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tidySpanishName = (value) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s+([),])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim()
    .replace(/\bflexion\b/g, "flexión")
    .replace(/\bextension\b/g, "extensión")
    .replace(/\belevacion\b/g, "elevación")
    .replace(/\brotacion\b/g, "rotación")
    .replace(/\baduccion\b/g, "aducción")
    .replace(/\babduccion\b/g, "abducción")
    .replace(/\bbiceps\b/g, "bíceps")
    .replace(/\btriceps\b/g, "tríceps")
    .replace(/\bcuadriceps\b/g, "cuádriceps")
    .replace(/\bgluteos\b/g, "glúteos")
    .replace(/\bgluteo\b/g, "glúteo")
    .replace(/\bmuneca\b/g, "muñeca")
    .replace(/\bmaquina\b/g, "máquina")
    .replace(/\belastica\b/g, "elástica")
    .replace(/\brigidas\b/g, "rígidas")
    .replace(/^./, (character) => character.toUpperCase());

const SPANISH_EQUIPMENT_SUFFIXES = [
  [" con maquina smith", "smith machine"],
  [" en maquina smith", "smith machine"],
  [" con maquina", "machine"],
  [" en maquina", "machine"],
  [" con mancuernas", "dumbbell"],
  [" con mancuerna", "dumbbell"],
  [" con barra", "barbell"],
  [" en polea", "cable"],
  [" con cable", "cable"],
  [" con banda elastica", "band"],
  [" con banda", "band"],
  [" con kettlebell", "kettlebell"],
  [" con pesa rusa", "kettlebell"],
  [" con balon medicinal", "medicine ball"],
];

const ENGLISH_PHRASE_TRANSLATIONS = [
  ["en maquina hack", "hack machine"],
  ["en maquina", "machine"],
  ["en polea baja", "low cable"],
  ["en polea alta", "high cable"],
  ["en polea", "cable"],
  ["con cuerda", "with rope"],
  ["press de banca", "bench press"],
  ["press de pecho", "chest press"],
  ["press de hombros", "shoulder press"],
  ["press militar", "military press"],
  ["peso muerto rumano", "romanian deadlift"],
  ["peso muerto", "deadlift"],
  ["sentadilla frontal", "front squat"],
  ["sentadilla hack", "hack squat"],
  ["sentadilla dividida", "split squat"],
  ["sentadilla", "squat"],
  ["zancada lateral", "lateral lunge"],
  ["zancada inversa", "reverse lunge"],
  ["zancada", "lunge"],
  ["dominada supina", "chin-up"],
  ["dominadas", "pull-up"],
  ["dominada", "pull-up"],
  ["jalon al pecho", "lat pulldown"],
  ["jalon", "pulldown"],
  ["flexion de brazos", "push-up"],
  ["flexiones", "push-up"],
  ["remo al menton", "upright row"],
  ["remo sentado", "seated row"],
  ["remo", "row"],
  ["curl de biceps", "biceps curl"],
  ["curl martillo", "hammer curl"],
  ["curl predicador", "preacher curl"],
  ["curl femoral", "leg curl"],
  ["extension de triceps", "triceps extension"],
  ["extension de piernas", "leg extension"],
  ["extension de cadera", "hip extension"],
  ["extension lumbar", "back extension"],
  ["elevacion de pantorrillas", "calf raise"],
  ["elevacion de talones", "heel raise"],
  ["elevacion de piernas", "leg raise"],
  ["elevacion de rodillas", "knee raise"],
  ["elevacion lateral", "lateral raise"],
  ["elevacion frontal", "front raise"],
  ["elevacion", "raise"],
  ["puente de gluteos", "glute bridge"],
  ["empuje de cadera", "hip thrust"],
  ["fondos para pecho", "chest dip"],
  ["fondos para triceps", "triceps dip"],
  ["fondos", "dip"],
  ["aperturas inversas", "reverse fly"],
  ["aperturas de pecho", "chest fly"],
  ["aperturas", "fly"],
  ["encogimiento abdominal", "crunch"],
  ["encogimiento de hombros", "shrug"],
  ["abdominal en v", "v-up"],
  ["abdominal", "sit-up"],
  ["plancha lateral", "side plank"],
  ["plancha frontal", "front plank"],
  ["plancha", "plank"],
  ["giro ruso", "russian twist"],
  ["giro", "twist"],
  ["rotacion interna", "internal rotation"],
  ["rotacion externa", "external rotation"],
  ["rotacion", "rotation"],
  ["aduccion", "adduction"],
  ["abduccion", "abduction"],
  ["estiramiento", "stretch"],
  ["subida al cajon", "step-up"],
  ["agarre cerrado", "close grip"],
  ["agarre amplio", "wide grip"],
  ["agarre inverso", "reverse grip"],
  ["agarre supino", "underhand grip"],
  ["agarre prono", "overhand grip"],
  ["una pierna", "single leg"],
  ["un brazo", "single arm"],
  ["inclinado", "incline"],
  ["declinado", "decline"],
  ["sentado", "seated"],
  ["acostado", "lying"],
  ["de pie", "standing"],
  ["arrodillado", "kneeling"],
  ["asistido", "assisted"],
  ["inverso", "reverse"],
  ["alterno", "alternating"],
  ["pecho", "chest"],
  ["espalda", "back"],
  ["hombro", "shoulder"],
  ["biceps", "biceps"],
  ["triceps", "triceps"],
  ["cuadriceps", "quadriceps"],
  ["isquiotibiales", "hamstring"],
  ["gluteos", "glutes"],
  ["gluteo", "glute"],
  ["pantorrillas", "calves"],
  ["brazo", "arm"],
  ["pierna", "leg"],
];

export const translateExerciseNameToSpanish = (name = "") => {
  const original = String(name).trim();
  if (!original) return "";
  const normalized = original.toLowerCase();
  if (EXACT_SPANISH_NAMES.has(normalized)) {
    return EXACT_SPANISH_NAMES.get(normalized);
  }

  let equipment = "";
  let translated = normalized;
  const prefix = EQUIPMENT_PREFIXES.find(([source]) =>
    translated.startsWith(source),
  );
  if (prefix) {
    equipment = prefix[1];
    translated = translated.slice(prefix[0].length);
  }

  [...PHRASE_TRANSLATIONS]
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([source, target]) => {
      translated = translated.replace(
        new RegExp(`\\b${escapeRegex(source)}\\b`, "gi"),
        target,
      );
    });

  if (equipment) translated = `${translated} con ${equipment}`;
  return tidySpanishName(translated);
};

export const translateExerciseNameToEnglish = (name = "") => {
  const original = String(name).trim();
  if (!original) return "";
  let translated = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let equipment = "";
  const suffix = SPANISH_EQUIPMENT_SUFFIXES.find(([source]) =>
    translated.endsWith(source),
  );
  if (suffix) {
    equipment = suffix[1];
    translated = translated.slice(0, -suffix[0].length);
  }
  [...ENGLISH_PHRASE_TRANSLATIONS]
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([source, target]) => {
      translated = translated.replace(
        new RegExp(`\\b${escapeRegex(source)}\\b`, "gi"),
        target,
      );
    });
  if (equipment) translated = `${equipment} ${translated}`;
  return translated
    .replace(/bench press incline/g, "incline bench press")
    .replace(/bench press decline/g, "decline bench press")
    .replace(/biceps curl alternating/g, "alternating biceps curl")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
};

export const getExerciseLanguage = (reqOrUser) => {
  const user = reqOrUser?.user || reqOrUser;
  return user?.profile?.language === "en" ? "en" : "es";
};

export const getLocalizedExerciseName = (exercise, language = "es") => {
  if (!exercise) return "";
  const english = exercise.localizedNames?.en || exercise.name || "";
  const spanish =
    exercise.localizedNames?.es || translateExerciseNameToSpanish(english);
  return language === "en" ? english : spanish;
};

export const localizeExerciseDocument = (exercise, language = "es") => {
  if (!exercise) return exercise;
  const plain = exercise.toObject?.() || { ...exercise };
  const englishName = plain.localizedNames?.en || plain.name || "";
  const spanishName =
    plain.localizedNames?.es || translateExerciseNameToSpanish(englishName);
  return {
    ...plain,
    name: language === "en" ? englishName : spanishName,
    nameEnglish: englishName,
    nameSpanish: spanishName,
  };
};

const collectReferenceIds = (documents = []) =>
  Array.from(
    new Set(
      documents.flatMap((document) =>
        (document.exercises || []).flatMap((exercise) => [
          exercise.exerciseId,
          ...(exercise.alternatives || []).map(
            (alternative) => alternative.exerciseId,
          ),
        ]),
      ),
    ),
  ).filter(Boolean);

export const localizeExerciseReferences = async (
  documents,
  language = "es",
) => {
  const list = Array.isArray(documents) ? documents : [documents];
  const ids = collectReferenceIds(list);
  if (!ids.length) return Array.isArray(documents) ? list : list[0];
  const exercises = await Exercise.find(
    { _id: { $in: ids } },
    "name localizedNames",
  ).lean();
  const names = new Map(
    exercises.map((exercise) => [
      String(exercise._id),
      getLocalizedExerciseName(exercise, language),
    ]),
  );
  const localized = list.map((document) => {
    const plain = document?.toObject?.() || { ...document };
    return {
      ...plain,
      exercises: (plain.exercises || []).map((exercise) => ({
        ...(exercise?.toObject?.() || exercise),
        name:
          names.get(String(exercise.exerciseId)) ||
          exercise.name ||
          exercise.exerciseName,
        exerciseName:
          names.get(String(exercise.exerciseId)) ||
          exercise.exerciseName ||
          exercise.name,
        alternatives: (exercise.alternatives || []).map((alternative) => ({
          ...(alternative?.toObject?.() || alternative),
          name:
            names.get(String(alternative.exerciseId)) || alternative.name,
        })),
      })),
    };
  });
  return Array.isArray(documents) ? localized : localized[0];
};
