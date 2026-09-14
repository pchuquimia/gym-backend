const validationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeNullableNumber = (value, label, maximum) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > maximum) {
    throw validationError(`${label} no es válido`);
  }
  return numeric;
};

export const normalizeHistoricalValueEdits = (values) => {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) {
    throw validationError("Las series enviadas no son válidas");
  }

  const seen = new Set();
  return values.map((value) => {
    const setIndex = Number(value?.setIndex);
    const entryIndex = Number(value?.entryIndex ?? 0);
    if (
      !Number.isInteger(setIndex) ||
      setIndex < 0 ||
      !Number.isInteger(entryIndex) ||
      entryIndex < 0
    ) {
      throw validationError("La posición de la serie no es válida");
    }
    const key = `${setIndex}:${entryIndex}`;
    if (seen.has(key)) {
      throw validationError("No se puede editar dos veces la misma serie");
    }
    seen.add(key);
    return {
      setIndex,
      entryIndex,
      weightKg: normalizeNullableNumber(value.weightKg, "El peso", 5000),
      reps: normalizeNullableNumber(value.reps, "Las repeticiones", 1000),
    };
  });
};

export const applyTrainingValueEdits = (exercise, values) => {
  values.forEach(({ setIndex, entryIndex, weightKg, reps }) => {
    const set = exercise.sets?.[setIndex];
    if (!set) throw validationError("Una de las series ya no existe");
    if (set.entries?.length) {
      const entry = set.entries[entryIndex];
      if (!entry) throw validationError("Una de las entradas ya no existe");
      entry.weightKg = weightKg;
      entry.reps = reps;
      return;
    }
    if (entryIndex !== 0) {
      throw validationError("La entrada indicada ya no existe");
    }
    set.weightKg = weightKg;
    set.reps = reps;
  });
};

export const applySessionValueEdits = (session, values) => {
  values.forEach(({ setIndex, entryIndex, weightKg, reps }) => {
    if (entryIndex !== 0 || !session.sets?.[setIndex]) {
      throw validationError("Una de las series ya no existe");
    }
    session.sets[setIndex].weight = weightKg;
    session.sets[setIndex].reps = reps;
  });
};
