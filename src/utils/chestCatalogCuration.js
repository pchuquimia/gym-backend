// Fichas equivalentes verificadas contra nombre, instrucciones e imágenes.
// Conservar el ID de destino mantiene una única opción en el buscador.
export const CHEST_DUPLICATE_MERGES = Object.freeze([
  ["dataset-hasane-0342", "dataset-hasane-0343"],
  ["dataset-hasane-0316", "dataset-hasane-0314"],
  ["dataset-hasane-0375", "dataset-hasane-0288"],
  ["dataset-hasane-0658", "dataset-hasane-0659"],
  ["dataset-hasane-1288", "dataset-hasane-1286"],
  ["dataset-hasane-1289", "dataset-hasane-1281"],
  ["dataset-hasane-1307", "dataset-hasane-0653"],
  ["dataset-hasane-1479", "dataset-hasane-1299"],
  ["dataset-hasane-1689", "dataset-hasane-0662"],
]);

// Datos que contradicen el movimiento o no permiten distinguir una variante.
export const CHEST_EXERCISES_TO_HIDE = Object.freeze({
  "dataset-hasane-0050": "El nombre indica elevación de hombros, pero las instrucciones describen un press.",
  "dataset-hasane-0328": "El nombre indica elevación de hombros, pero las instrucciones describen un press.",
  "dataset-hasane-0458": "No es posible hacer aperturas independientes con una barra recta.",
  "dataset-hasane-0492": "La secuencia del salto es ambigua y puede inducir a una ejecución incorrecta.",
  "dataset-hasane-0759": "La descripción no precisa el movimiento de hombros indicado por el nombre.",
  "dataset-hasane-1305": "La descripción coincide con la variante de respuesta múltiple; no explica una ejecución distinta.",
  "dataset-hasane-1716": "La descripción no corresponde a un estiramiento asistido de pectoral.",
});

export const CHEST_EXERCISE_METADATA = Object.freeze({
  "dataset-hasane-0040": { group: "Hombros", pattern: "Elevación de hombro" },
  "dataset-hasane-0191": { group: "Hombros", pattern: "Abducción de hombro" },
  "dataset-hasane-0500": { group: "Oblicuos", pattern: "Rotación" },
  "dataset-hasane-2139": { group: "Ejercicios metabólicos", pattern: "Pedaleo de brazos", category: "Cardio", loadType: "cardio" },
  "dataset-hasane-2203": { group: "Hombros", pattern: "Elevación de hombro", equipment: ["Rodillo"] },
  "dataset-hasane-2209": { group: "Hombros", pattern: "Elevación de hombro", equipment: ["Rodillo"] },
  "dataset-hasane-1310": { equipment: ["Peso corporal"], category: "Pliometría", loadType: "bodyweight" },
});

export const CHEST_DESCRIPTION_FIXES = Object.freeze({
  "dataset-hasane-0656": [
    "Coloca los pies sobre el fitball y las manos en el suelo, separadas a la anchura de los hombros.",
    "Mantén el cuerpo alineado desde los hombros hasta los tobillos y activa el abdomen.",
    "Flexiona los codos para bajar el pecho hacia el suelo sin dejar que el balón se desplace.",
    "Empuja con las manos hasta volver a la posición inicial y repite.",
  ],
});

export const buildChestMetadataPatch = (meta) => {
  const patch = {};
  if (meta.group) {
    const [bodyRegion, navigationRegion] = meta.group === "Oblicuos" ? ["Zona media", "Core"]
      : meta.group === "Ejercicios metabólicos" ? ["Cuerpo completo", "Cuerpo completo"]
        : ["Tren superior", "Hombros"];
    Object.assign(patch, {
      primaryMuscleGroup: meta.group,
      primaryMuscle: meta.group,
      muscle: meta.group,
      primaryMuscles: meta.group === "Oblicuos" ? ["obliques", "abs"]
        : meta.group === "Ejercicios metabólicos" ? ["cardiovascular system"] : ["delts"],
      bodyRegion,
      navigationRegion,
    });
  }
  if (meta.pattern) Object.assign(patch, { movementPattern: meta.pattern, movementPatterns: [meta.pattern] });
  if (meta.category) Object.assign(patch, { category: meta.category, categories: [meta.category] });
  if (meta.equipment) patch.equipment = meta.equipment;
  if (meta.loadType) patch.loadType = meta.loadType;
  return patch;
};
