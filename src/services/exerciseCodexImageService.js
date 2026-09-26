const DEFAULT_CODEX_IMAGE_PROMPT = `Edita la imagen de referencia para crear una ilustracion fitness anatomica realista y profesional para una aplicacion de ejercicios.

REGLA PRIORITARIA DE REFERENCIA: trata la imagen como la fuente visual principal. Conserva exactamente el ejercicio, la pose, orientacion, angulo de camara, fase del movimiento, colocacion de manos y pies, postura articular, agarre y todo el equipo visible. No sustituyas, agregues, quites ni reubiques equipamiento. No inventes una pose mas generica. Mantén a la persona completa y cada pieza importante de equipo dentro del encuadre.

ANATOMIA Y ROPA: usa anatomia humana realista, proporcionada y musculatura definida pero natural. Mantén ropa deportiva funcional cuando permita identificar el movimiento. Si pecho o espalda son el foco principal y deben poder verse, usa torso descubierto de forma respetuosa y no sexualizada; para hombros, usa una prenda sin mangas que deje visibles los deltoides. Nunca sacrifiques la pose, seguridad o reconocimiento del ejercicio por la ropa.

MAPA E INTENSIDAD MUSCULAR: usa las zonas rojas ya marcadas en la referencia como guia prioritaria de ubicacion. Contrasta esas zonas con la biomecanica y los datos principales/secundarios del ejercicio. Mantén rojo solo sobre musculos que realmente participan y en su vientre anatomico correcto. Diferencia la participacion con un gradiente discreto: musculos principales con rojo carmesi oscuro semitransparente de intensidad moderada; musculos secundarios con un rojo mucho mas tenue; resto del cuerpo con tono natural. No hagas el rojo brillante, saturado, opaco, neon ni excesivo: la textura de piel y las fibras deben seguir claramente visibles. No expandas el area roja por conveniencia ni colorees grupos no implicados.

REGLA ABSOLUTA DE PRENDAS: el rojo solo puede aparecer sobre piel visible en la zona muscular correspondiente. Nunca dibujes, proyectes ni dejes sangrar resaltado rojo sobre camisetas, shorts, leggings, zapatos, guantes, bandas u otro equipo. Si una zona muscular esta cubierta, deja la prenda de su color original; no simules musculos rojos a traves de la tela.

FONDO Y LUZ: gimnasio moderno oscuro en negro y grafito, totalmente opaco, con equipo discreto y una iluminacion ambiental posterior muy sutil. Usa luz cinematografica lateral suave y sombras oscuras pero legibles. No uses fondo blanco, gris claro, transparente ni patron de tablero; evita un fondo vacio o iluminacion plana.

SALIDA Y CONTROL DE CALIDAD: imagen cuadrada 1:1, persona centrada, cuerpo entero y equipo esencial completamente visibles con margenes seguros. Sin texto, flechas, etiquetas, logos, marcas de agua ni objetos ajenos al ejercicio. Antes de dar por terminada la imagen, comprueba visualmente: pose y equipo coinciden con la referencia; fondo oscuro y opaco; musculos principales mas destacados que los secundarios sin rojo exagerado; ninguna prenda tiene rojo; no hay extremidades ni equipo cortados.`;

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
