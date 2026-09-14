import {
  classifyExerciseLoad,
  getTrainingLoadMetrics,
} from "./trainingLoad.js";

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

export const resolvePlannedTrainingSlot = ({
  weeklySchedule = [],
  scheduleMode = "fixed",
  cycleIndex = 0,
  routineId,
  date,
}) => {
  const normalizedDate = normalizeTrainingDateKey(date);
  const normalizedRoutineId = String(routineId || "");
  if (!normalizedDate || !normalizedRoutineId) return null;

  if (scheduleMode !== "fixed") {
    const expectedSlot = weeklySchedule[Number(cycleIndex) || 0];
    return expectedSlot?.type === "training" &&
      String(expectedSlot.routineId || "") === normalizedRoutineId
      ? expectedSlot
      : null;
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00Z`);
  const dayIndex = ((parsedDate.getUTCDay() + 6) % 7) + 1;
  const matches = weeklySchedule.filter(
    (slot) =>
      slot.type === "training" &&
      Number(slot.dayIndex) === dayIndex &&
      String(slot.routineId || "") === normalizedRoutineId,
  );
  return matches.length === 1 ? matches[0] : null;
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

  const invalidBodyweightEntry = (Array.isArray(exercises) ? exercises : [])
    .filter((exercise) => {
      const loadType = classifyExerciseLoad(exercise);
      return (
        loadType === "bodyweight" ||
        loadType === "assisted" ||
        exercise?.weightBasis === "additional" ||
        exercise?.weightBasis === "assistance"
      );
    })
    .flatMap((exercise) => exercise?.sets || [])
    .flatMap((set) =>
      Array.isArray(set?.entries) && set.entries.length ? set.entries : [set],
    )
    .find((entry) => {
      if (entry?.done !== true) return false;
      const rawWeight = entry?.weightKg ?? entry?.weight ?? entry?.kg;
      const rawReps = entry?.reps ?? entry?.repetitions;
      const weight = Number(rawWeight);
      const reps = Number(rawReps);
      return (
        rawWeight === null ||
        rawWeight === undefined ||
        rawWeight === "" ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        rawReps === null ||
        rawReps === undefined ||
        rawReps === "" ||
        !Number.isFinite(reps) ||
        reps <= 0
      );
    });

  if (invalidBodyweightEntry) {
    return {
      ok: false,
      status: 422,
      code: "BODYWEIGHT_SET_INCOMPLETE",
      error:
        "En fondos y dominadas, registra 0 si usaste solo tu peso corporal y completa las repeticiones",
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
