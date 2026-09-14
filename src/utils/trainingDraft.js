export const MAX_TRAINING_DRAFT_BYTES = 1_500_000;
export const MAX_DRAFT_EXERCISES = 120;
export const MAX_DRAFT_SETS_PER_EXERCISE = 100;
export const MAX_DRAFT_ENTRIES_PER_SET = 3;

const invalidDraft = (message) => ({ ok: false, error: message });

export const validateTrainingDraftSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return invalidDraft("El borrador del entrenamiento no es válido");
  }
  if (!String(snapshot.selectedRoutineId || "").trim()) {
    return invalidDraft("El borrador debe incluir una rutina");
  }
  if (!String(snapshot.trainingRequestId || "").trim()) {
    return invalidDraft("El borrador debe incluir un identificador de sesion");
  }

  const exercises = Array.isArray(snapshot.exercises) ? snapshot.exercises : [];
  if (exercises.length > MAX_DRAFT_EXERCISES) {
    return invalidDraft("El borrador contiene demasiados ejercicios");
  }
  for (const exercise of exercises) {
    const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    if (sets.length > MAX_DRAFT_SETS_PER_EXERCISE) {
      return invalidDraft("El borrador contiene demasiadas series");
    }
    if (
      sets.some(
        (set) =>
          Array.isArray(set?.entries) &&
          set.entries.length > MAX_DRAFT_ENTRIES_PER_SET,
      )
    ) {
      return invalidDraft("El borrador contiene demasiadas entradas por serie");
    }
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    return invalidDraft("El borrador no se puede serializar");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_TRAINING_DRAFT_BYTES) {
    return invalidDraft("El borrador supera el tamaño permitido");
  }

  return { ok: true, snapshot: JSON.parse(serialized) };
};
