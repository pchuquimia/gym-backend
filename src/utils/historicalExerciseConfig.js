export const HISTORICAL_WEIGHT_BASES = new Set([
  "legacy",
  "total",
  "per_side",
  "per_implement",
  "machine",
  "additional",
  "assistance",
]);

const validationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

export const normalizeHistoricalExerciseConfig = (
  payload = {},
  current = {},
) => {
  const movementMode = String(
    payload.movementMode ?? current.movementMode ?? "bilateral",
  );
  if (!["bilateral", "unilateral"].includes(movementMode)) {
    throw validationError("La modalidad debe ser bilateral o unilateral");
  }

  const weightBasis = String(
    payload.weightBasis ?? current.weightBasis ?? "legacy",
  );
  if (!HISTORICAL_WEIGHT_BASES.has(weightBasis)) {
    throw validationError("La base de peso no es válida");
  }

  const rawBarWeight = Number(payload.barWeightKg ?? current.barWeightKg ?? 0);
  if (
    !Number.isFinite(rawBarWeight) ||
    rawBarWeight < 0 ||
    rawBarWeight > 500
  ) {
    throw validationError("El peso de la barra debe estar entre 0 y 500 kg");
  }

  const rawImplementCount = Number(
    payload.implementCount ?? current.implementCount ?? 1,
  );
  if (
    !Number.isInteger(rawImplementCount) ||
    rawImplementCount < 1 ||
    rawImplementCount > 4
  ) {
    throw validationError("La cantidad de implementos debe estar entre 1 y 4");
  }

  return {
    movementMode,
    weightBasis,
    barWeightKg: weightBasis === "per_side" ? rawBarWeight : 0,
    implementCount: weightBasis === "per_implement" ? rawImplementCount : 1,
  };
};
