const OPENAI_IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_MODEL = "gpt-image-2";
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

const DEFAULT_PROMPT = `Convierte la imagen de referencia en una ilustracion fitness anatomica realista y profesional para una aplicacion de ejercicios. Conserva exactamente la pose, posicion corporal, orientacion, angulo de camara, movimiento y ejercicio mostrados en la imagen original.

Representa a la persona con anatomia humana realista, proporciones correctas, musculatura definida pero natural y apariencia deportiva. Manten ropa adecuada para entrenamiento y evita cualquier apariencia de desnudez.

Identifica anatomicamente los musculos principales que se trabajan y resaltalos en rojo intenso siguiendo con precision su ubicacion, forma, extension y orientacion anatomica. Los musculos secundarios pueden resaltarse con un rojo ligeramente menos intenso cuando sea pertinente. No colorees musculos que no participen de manera relevante. El resaltado debe integrarse de forma realista y permitir distinguir fasciculos y limites musculares sin convertir toda la zona en una mancha roja.

Manten el resto del cuerpo con piel y apariencia natural. Usa un estilo fotorrealista de visualizacion anatomica fitness, alta definicion, iluminacion suave y uniforme de estudio, sombras naturales y fondo blanco o gris muy claro completamente limpio. Sin texto, flechas, etiquetas, logos, marcas de agua ni objetos que no aparezcan en la referencia.

Genera una imagen cuadrada 1:1, con el cuerpo completamente visible, centrado y con margenes adecuados. La prioridad absoluta es conservar el ejercicio y la posicion original, modificando principalmente el estilo visual y la representacion anatomica de los musculos trabajados. El resultado debe pertenecer a una biblioteca visual premium y consistente de ejercicios.`;

const createError = (message, statusCode = 500, details = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const exerciseContext = (exercise) => {
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

export const getExerciseAiImageStatus = () => ({
  configured: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL,
});

export const generateExerciseAiImage = async ({
  exercise,
  prompt = "",
  userId = "",
}) => {
  const { configured, model } = getExerciseAiImageStatus();
  if (!configured) {
    throw createError(
      "La generacion con IA no esta configurada. Agrega OPENAI_API_KEY al backend.",
      503,
    );
  }

  const referenceImage =
    exercise.media?.image?.url || exercise.image || exercise.thumb || "";
  if (!/^https?:\/\//i.test(referenceImage)) {
    throw createError(
      "El ejercicio necesita una imagen de referencia accesible antes de generar.",
      422,
    );
  }

  const customPrompt = String(prompt || "").trim();
  const finalPrompt =
    `${customPrompt || DEFAULT_PROMPT}\n\nDATOS DEL EJERCICIO:\n${exerciseContext(exercise)}`.slice(
      0,
      32000,
    );

  let response;
  try {
    response = await fetch(OPENAI_IMAGES_EDIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        images: [{ image_url: referenceImage }],
        prompt: finalPrompt,
        size: "1600x1600",
        quality: "high",
        output_format: "webp",
        output_compression: 90,
        background: "opaque",
        n: 1,
        user: userId || undefined,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw createError("La generacion excedio el tiempo de espera.", 504);
    }
    throw createError("No se pudo conectar con el servicio de imagenes.", 502);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const statusCode = response.status === 429 ? 429 : 502;
    throw createError(
      payload?.error?.message || "La IA no pudo generar la imagen.",
      statusCode,
      payload?.error?.code ? { code: payload.error.code } : null,
    );
  }

  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw createError("La IA no devolvio una imagen valida.", 502);
  }

  return {
    dataUrl: `data:image/webp;base64,${imageBase64}`,
    model,
    format: payload.output_format || "webp",
    size: payload.size || "1600x1600",
    quality: payload.quality || "high",
  };
};

export { DEFAULT_PROMPT as DEFAULT_EXERCISE_AI_IMAGE_PROMPT };
