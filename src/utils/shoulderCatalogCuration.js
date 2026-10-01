export const SHOULDER_DUPLICATE_MERGES = Object.freeze([
  ["dataset-hasane-0119", "dataset-hasane-0120"],
  ["dataset-hasane-0121", "dataset-hasane-0120"],
  ["dataset-hasane-0161", "dataset-hasane-0162"],
  ["dataset-hasane-0164", "dataset-hasane-0162"],
  ["dataset-hasane-0287", "dataset-hasane-2137"],
  ["dataset-hasane-0309", "dataset-hasane-0310"],
  ["dataset-hasane-0360", "dataset-hasane-0361"],
  ["dataset-hasane-0376", "dataset-hasane-0334"],
  ["dataset-hasane-0378", "dataset-hasane-0383"],
  ["dataset-hasane-0395", "dataset-hasane-0396"],
  ["dataset-hasane-1765", "dataset-hasane-0437"],
  ["dataset-hasane-2136", "dataset-hasane-0299"],
  ["dataset-hasane-2318", "dataset-hasane-0869"],
]);

export const SHOULDER_EXERCISES_TO_HIDE = Object.freeze({
  "dataset-hasane-0100": "El movimiento skier no coincide con el salto y tirón de barra descritos.",
  "dataset-hasane-0290": "La ficha está en hombros, pero las instrucciones describen un press de pecho en banco.",
  "dataset-hasane-0377": "El nombre indica remo, pero las instrucciones describen aperturas inversas.",
  "dataset-hasane-0527": "La secuencia indicada para el jerk es contradictoria.",
  "dataset-hasane-0543": "El nombre de origen es ilegible y no permite identificar una variante técnica.",
  "dataset-hasane-0552": "La ficha indica dos pesas rusas, pero las instrucciones usan solo una.",
  "dataset-hasane-0844": "El equipo indicado son discos, pero las instrucciones usan mancuernas.",
  "dataset-hasane-3641": "El nombre y la ejecución no identifican una variante de hombros clara.",
});

export const SHOULDER_EXERCISE_METADATA = Object.freeze({
  "dataset-hasane-0067": { group: "Full body", pattern: "Arrancada" },
  "dataset-hasane-0128": { group: "Ejercicios metabólicos", category: "Cardio", pattern: "Ondas" },
  "dataset-hasane-0529": { group: "Levantamientos olímpicos", pattern: "Arrancada" },
  "dataset-hasane-0537": { group: "Levantamientos olímpicos", pattern: "Cargada y jerk" },
  "dataset-hasane-0542": { group: "Levantamientos olímpicos", pattern: "Arrancada" },
  "dataset-hasane-0550": { group: "Movimientos combinados", pattern: "Sentadilla y press" },
  "dataset-hasane-2271": { group: "Ejercicios metabólicos", category: "Cardio", pattern: "Golpeo" },
  "dataset-hasane-3305": { group: "Movimientos combinados", pattern: "Sentadilla y press" },
});

export const buildShoulderMetadataPatch = (meta) => {
  const patch = {};
  if (meta.group) Object.assign(patch, {
    primaryMuscleGroup: meta.group,
    primaryMuscle: meta.group,
    muscle: meta.group,
    primaryMuscles: ["core"],
    bodyRegion: "Cuerpo completo",
    navigationRegion: "Cuerpo completo",
  });
  if (meta.pattern) Object.assign(patch, { movementPattern: meta.pattern, movementPatterns: [meta.pattern] });
  if (meta.category) Object.assign(patch, { category: meta.category, categories: [meta.category] });
  return patch;
};
