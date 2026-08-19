const DEFAULT_CODEX_IMAGE_PROMPT = `Edita la imagen de referencia y conviertela en una ilustracion fitness anatomica realista y profesional para una aplicacion de ejercicios. Conserva exactamente la pose, posicion corporal, orientacion, angulo de camara, movimiento, equipo y ejercicio mostrados en la imagen original.

Representa a la persona con anatomia humana realista, proporciones correctas, musculatura definida pero natural y ropa adecuada para entrenamiento.

Identifica anatomicamente los musculos principales que se trabajan y resaltalos en rojo intenso siguiendo con precision su ubicacion, forma, extension y orientacion anatomica. Conserva los musculos secundarios y el resto del cuerpo en tono natural. No colorees musculos que no participen de manera principal. El resaltado debe integrarse de forma realista y permitir distinguir fasciculos y limites musculares sin convertir toda la zona en una mancha roja.

Usa un estilo fotorrealista de visualizacion anatomica fitness, alta definicion, iluminacion suave y uniforme de estudio, sombras naturales y fondo blanco o gris muy claro completamente limpio. Sin texto, flechas, etiquetas, logos, marcas de agua ni objetos que no aparezcan en la referencia.

Genera una imagen cuadrada 1:1, con el cuerpo completamente visible, centrado y con margenes adecuados. La prioridad absoluta es conservar el ejercicio y la posicion original. El resultado debe pertenecer a una biblioteca visual premium y consistente de ejercicios.`;

const createError = (message, statusCode = 422) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const exerciseContext = (exercise = {}) => {
  const primary = [
    ...(exercise.primaryMuscles || []),
    exercise.primaryMuscleGroup,
    exercise.primaryMuscle,
    exercise.muscle,
  ].filter(Boolean);
  const secondary = (exercise.secondaryMuscles || []).filter(Boolean);
  return [
    `Ejercicio: ${exercise.localizedNames?.es || exercise.name}.`,
    primary.length
      ? `Musculos principales registrados: ${[...new Set(primary)].join(", ")}.`
      : "",
    secondary.length
      ? `Musculos secundarios registrados: ${[...new Set(secondary)].join(", ")}.`
      : "",
    exercise.movementPattern
      ? `Patron de movimiento: ${exercise.movementPattern}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const getExerciseReferenceImage = (exercise = {}) => {
  const referenceImage =
    exercise.media?.image?.url || exercise.image || exercise.thumb || "";
  if (!/^https?:\/\//i.test(referenceImage)) {
    throw createError(
      "El ejercicio necesita una imagen de referencia accesible antes de solicitarla a Codex.",
    );
  }
  return referenceImage;
};

export const buildExerciseCodexImagePrompt = (
  exercise,
  instruction = "",
) => {
  const customInstruction = String(instruction || "").trim().slice(0, 2000);
  return `${DEFAULT_CODEX_IMAGE_PROMPT}\n\nDATOS DEL EJERCICIO:\n${exerciseContext(
    exercise,
  )}${
    customInstruction
      ? `\n\nINSTRUCCION ADICIONAL DEL ADMINISTRADOR:\n${customInstruction}`
      : ""
  }`.slice(0, 32000);
};

export {
  DEFAULT_CODEX_IMAGE_PROMPT,
  exerciseContext as buildExerciseCodexContext,
};
