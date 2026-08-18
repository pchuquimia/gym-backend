import { getTrainingLoadMetrics } from "./trainingLoad.js";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const localDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export const normalizeTrainingDateKey = (value) => {
  if (value instanceof Date) return localDateKey(value);
  if (typeof value !== "string") return null;

  const candidate = value.trim().slice(0, 10);
  if (!DATE_KEY_PATTERN.test(candidate)) return null;
  const parsed = new Date(`${candidate}T12:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
  ) {
    return null;
  }
  return candidate;
};

export const buildTrainingRegistrationKey = ({ ownerId, date, routineId }) => {
  const parts = [ownerId, date, routineId].map((value) =>
    String(value || "").trim(),
  );
  return parts.every(Boolean) ? `v1:${parts.join(":")}` : undefined;
};

export const validateTrainingSubmission = ({
  date,
  exercises,
  fallbackDate = new Date(),
}) => {
  const hasSubmittedDate = date !== null && date !== undefined && date !== "";
  const normalizedDate = hasSubmittedDate
    ? normalizeTrainingDateKey(date)
    : normalizeTrainingDateKey(fallbackDate);

  if (!normalizedDate) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_TRAINING_DATE",
      error: "La fecha del entrenamiento no es valida",
    };
  }

  const loadMetrics = getTrainingLoadMetrics(exercises);
  if (loadMetrics.recordedSets < 1) {
    return {
      ok: false,
      status: 422,
      code: "EMPTY_TRAINING",
      error: "Registra al menos una serie antes de guardar el entrenamiento",
    };
  }

  return { ok: true, date: normalizedDate, loadMetrics };
};
