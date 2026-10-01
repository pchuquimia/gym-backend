// Solo se consolidan fichas con movimiento, apoyo y equipo equivalentes.
export const BACK_DUPLICATE_MERGES = Object.freeze([
  ["dataset-hasane-0199", "dataset-hasane-0238"],
  ["dataset-hasane-0497", "dataset-hasane-0499"],
  ["dataset-hasane-1351", "dataset-hasane-1349"],
]);

// Instrucciones contradictorias o demasiado vagas para ofrecerlas como ejercicio.
export const BACK_EXERCISES_TO_HIDE = Object.freeze({
  "dataset-hasane-0007": "El nombre indica alternancia, pero las instrucciones describen un jalón simultáneo.",
  "dataset-hasane-0172": "La posición indicada no permite reconocer con seguridad el pushdown descrito.",
  "dataset-hasane-0574": "La ficha dice máquina de palanca, pero las instrucciones describen una barra libre.",
  "dataset-hasane-0589": "La ficha dice máquina unilateral, pero las instrucciones describen una barra libre bilateral.",
  "dataset-hasane-0609": "El movimiento London bridge no coincide con el remo de cuerda descrito.",
  "dataset-hasane-0670": "La variante posterior se describe como una dominada convencional.",
  "dataset-hasane-0678": "La variante Rocky no se distingue de una dominada convencional en las instrucciones.",
  "dataset-hasane-0720": "La variante lateral no aparece en las instrucciones.",
  "dataset-hasane-1332": "Nombre, equipamiento e instrucciones describen movimientos diferentes.",
  "dataset-hasane-1355": "No queda claro si se trata de una activación dorsal o un empuje isométrico.",
  "dataset-hasane-1358": "La elevación de pierna descrita no permite identificar el estiramiento dorsal.",
  "dataset-hasane-1401": "La barra vertical y las instrucciones no describen la transición de un muscle-up.",
  "dataset-hasane-1772": "La descripción corresponde a un empuje en el suelo, no a un ejercicio de espalda.",
  "dataset-hasane-3012": "Las instrucciones de fondos escapulares no describen una posición de fondos.",
  "dataset-hasane-3019": "La descripción de dominadas en banco no identifica el uso de un banco.",
  "dataset-hasane-3292": "Elevator no identifica el movimiento de bisagra de cadera descrito.",
  "dataset-hasane-3295": "El nombre indica front lever, pero las instrucciones describen una elevación de piernas.",
  "dataset-hasane-3297": "El nombre indica back lever, pero las instrucciones describen una elevación frontal.",
  "dataset-hasane-3418": "Las instrucciones de dominadas en L omiten la posición de las piernas.",
});

export const BACK_EXERCISE_METADATA = Object.freeze({
  "dataset-hasane-0548": { group: "Full body", pattern: "Tirón alto" },
  "dataset-hasane-0716": { group: "Hombros", pattern: "Movilidad cervical" },
  "dataset-hasane-0794": { group: "Oblicuos", pattern: "Flexión lateral" },
  "dataset-hasane-1353": { group: "Ejercicios metabólicos", category: "Pliometría", pattern: "Lanzamiento" },
  "dataset-hasane-1354": { group: "Ejercicios metabólicos", category: "Pliometría", pattern: "Lanzamiento" },
  "dataset-hasane-1403": { group: "Hombros", pattern: "Movilidad cervical" },
  "dataset-hasane-2207": { equipment: ["Rodillo"] },
  "dataset-hasane-3541": { group: "Hombros", pattern: "Elevación de hombro" },
  "dataset-hasane-3664": { group: "Hombros", pattern: "Abducción de hombro" },
  "dataset-hasane-3669": { group: "Oblicuos", pattern: "Rotación" },
});

export const buildBackMetadataPatch = (meta) => {
  const patch = {};
  if (meta.group) {
    const core = meta.group === "Oblicuos";
    const full = meta.group === "Full body" || meta.group === "Ejercicios metabólicos";
    Object.assign(patch, {
      primaryMuscleGroup: meta.group,
      primaryMuscle: meta.group,
      muscle: meta.group,
      primaryMuscles: core ? ["obliques", "abs"] : full ? ["core"] : ["delts", "trapezius"],
      bodyRegion: core ? "Zona media" : full ? "Cuerpo completo" : "Tren superior",
      navigationRegion: core ? "Core" : full ? "Cuerpo completo" : "Hombros",
    });
  }
  if (meta.pattern) Object.assign(patch, { movementPattern: meta.pattern, movementPatterns: [meta.pattern] });
  if (meta.category) Object.assign(patch, { category: meta.category, categories: [meta.category] });
  if (meta.equipment) patch.equipment = meta.equipment;
  return patch;
};
