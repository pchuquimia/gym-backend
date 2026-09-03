const DEFAULT_CODEX_IMAGE_PROMPT = `Edita la imagen de referencia y conviertela en una ilustracion fitness anatomica realista y profesional para una aplicacion de ejercicios. Conserva exactamente la pose, posicion corporal, orientacion, angulo de camara, movimiento, equipo y ejercicio mostrados en la imagen original.

Representa a la persona con anatomia humana realista, proporciones correctas, musculatura definida pero natural y ropa adecuada para entrenamiento. REGLA DE VISIBILIDAD MUSCULAR: cuando el ejercicio trabaje principalmente pecho/pectorales o espalda/dorsales y la zona deba verse para validar el resaltado, usa al atleta sin camiseta (torso descubierto, respetuoso y no sexualizado) para que el musculo sea claramente visible. Cuando el ejercicio trabaje principalmente hombros/deltoides, usa una musculosa deportiva de tirantes o sin mangas que deje ambos hombros claramente descubiertos y permita focalizar el movimiento. Mantén ropa deportiva cuando el ejercicio no requiera mostrar esas zonas, especialmente en piernas, brazos aislados, movilidad o estiramientos. Nunca sacrifiques la postura, seguridad ni reconocimiento del ejercicio por esta regla.

La zona anatomica que ya aparece remarcada en rojo en la imagen de referencia es una guia visual importante, pero no debe copiarse ciegamente. Analiza siempre el ejercicio, su biomecanica, el patron de movimiento, la posicion articular y los musculos realmente implicados. Si el resaltado de la muestra, los datos textuales o cualquier elemento visual es incorrecto, corrige la ubicacion y el alcance segun el criterio anatomico y de entrenamiento mas preciso. El resultado debe mostrar los musculos que de verdad trabajan en ese ejercicio, sin extender el rojo a zonas que no participan de forma principal.

Identifica anatomicamente los musculos principales que se trabajan y resaltalos con un rojo carmesi oscuro, sutil y semitransparente, siguiendo con precision su ubicacion, forma, extension y orientacion anatomica. Conserva los musculos secundarios y el resto del cuerpo en tono natural. No colorees musculos que no participen de manera principal. El resaltado debe integrarse con la piel y la iluminacion, conservar textura, fibras y volumen, y nunca parecer neon, pintura opaca ni una mancha plana.

Usa un estilo fotorrealista de visualizacion anatomica fitness, alta definicion y la atmosfera visual oscura de la imagen Lower B del proyecto: gimnasio moderno en negro y grafito, equipamiento oscuro, iluminacion cinematografica lateral, contraste controlado y sombras profundas con detalle legible. No uses fondos blancos, grises claros ni iluminacion plana. Sin texto, flechas, etiquetas, logos, marcas de agua ni objetos que alteren el ejercicio de la referencia.

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
