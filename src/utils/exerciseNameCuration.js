import { CHEST_EXERCISE_NAME_CORRECTIONS } from "./chestExerciseNames.js";
import { BACK_EXERCISE_NAME_CORRECTIONS } from "./backExerciseNames.js";
import { SHOULDER_EXERCISE_NAME_CORRECTIONS } from "./shoulderExerciseNames.js";

// Correcciones revisadas contra el nombre inglés, músculo y equipamiento del catálogo.
// El identificador del ejercicio permanece estable para rutinas e historiales.
export const EXERCISE_NAME_CORRECTIONS = Object.freeze({
  "dataset-hasane-0030": {
    from: "Agarre cerrado press de banca con barra",
    es: "Press de banca con barra y agarre cerrado",
  },
  "dataset-hasane-0031": {
    from: "Curl con barra",
    es: "Curl de bíceps con barra",
    removeAliases: ["Press con barra libre"],
  },
  "dataset-hasane-0033": {
    from: "Declinado press de banca con barra",
    es: "Press de banca declinado con barra",
  },
  "dataset-hasane-0620": {
    from: "Acostado elevación de piernas flat banco",
    es: "Elevación de piernas acostado en banco plano",
  },
  "dataset-hasane-0738": {
    from: "Sled 45в° calf press",
    es: "Elevación de pantorrillas en prensa a 45°",
    en: "Sled 45° calf press",
    preserveOld: false,
  },
  "dataset-hasane-0740": {
    from: "Sled 45в° pierna amplio press",
    es: "Prensa de piernas a 45° con postura amplia",
    en: "Sled 45° leg wide press",
    preserveOld: false,
  },
  "dataset-hasane-0748": {
    from: "Smith press de banca",
    es: "Press de banca en máquina Smith",
  },
  "dataset-hasane-0757": {
    from: "Smith inclinado press de banca",
    es: "Press de banca inclinado en máquina Smith",
  },
  "dataset-hasane-0765": {
    from: "Smith sentado press de hombros",
    es: "Press de hombros sentado en máquina Smith",
  },
  "dataset-hasane-3122": {
    from: "Resistance band sentado press de hombros",
    es: "Press de hombros sentado con banda elástica",
  },
  "dataset-hasane-3123": {
    from: "Resistance band sentado curl de bíceps",
    es: "Curl de bíceps sentado con banda elástica",
  },
  "dataset-hasane-3124": {
    from: "Resistance band sentado press de pecho",
    es: "Press de pecho sentado con banda elástica",
  },
  ...CHEST_EXERCISE_NAME_CORRECTIONS,
  ...BACK_EXERCISE_NAME_CORRECTIONS,
  ...SHOULDER_EXERCISE_NAME_CORRECTIONS,
});

export const getCuratedExerciseNamePatch = (
  exercise,
  corrections = EXERCISE_NAME_CORRECTIONS,
) => {
  const correction = corrections[exercise?._id];
  if (!correction) return null;
  const currentName = exercise.localizedNames?.es || "";
  if (currentName !== correction.from && currentName !== correction.es &&
      !(correction.previousNames || []).includes(currentName)) {
    return { status: "conflict", expected: correction.from, actual: currentName };
  }

  const removed = new Set((correction.removeAliases || []).map((alias) => alias.toLocaleLowerCase("es")));
  const aliases = (exercise.aliases || []).filter((alias) => !removed.has(alias.toLocaleLowerCase("es")));
  if (correction.preserveOld !== false && currentName === correction.from) aliases.push(currentName);
  aliases.push(...(correction.addAliases || []));
  const uniqueAliases = [...new Map(aliases.map((alias) => [alias.toLocaleLowerCase("es"), alias])).values()];
  const values = { "localizedNames.es": correction.es, aliases: uniqueAliases };
  if (correction.en) values["localizedNames.en"] = correction.en;

  const changed = currentName !== correction.es ||
    (correction.en && exercise.localizedNames?.en !== correction.en) ||
    JSON.stringify(exercise.aliases || []) !== JSON.stringify(uniqueAliases);
  return changed
    ? { status: "change", values, before: currentName, after: correction.es }
    : { status: "current" };
};
