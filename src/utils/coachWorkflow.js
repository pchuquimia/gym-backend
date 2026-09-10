export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "number",
  "single_choice",
  "multiple_choice",
  "yes_no",
];

export const DEFAULT_INTAKE_QUESTIONS = [
  {
    key: "medical_conditions",
    label: "¿Tienes alguna condición médica que tu coach deba conocer?",
    type: "long_text",
    required: true,
    enabled: true,
    options: [],
  },
  {
    key: "medications",
    label: "¿Tomas medicamentos que puedan influir en tu entrenamiento?",
    type: "long_text",
    required: false,
    enabled: true,
    options: [],
  },
  {
    key: "injuries",
    label: "¿Tienes lesiones, dolor o movimientos que debamos evitar?",
    type: "long_text",
    required: true,
    enabled: true,
    options: [],
  },
  {
    key: "equipment",
    label: "¿Dónde entrenarás y qué equipamiento tienes disponible?",
    type: "long_text",
    required: true,
    enabled: true,
    options: [],
  },
  {
    key: "preferences",
    label: "¿Qué ejercicios disfrutas o prefieres evitar?",
    type: "long_text",
    required: false,
    enabled: true,
    options: [],
  },
];

export const DEFAULT_FOLLOW_UP = {
  checkIn: { enabled: true, cadence: "workout_days", weekdays: [] },
  weight: {
    enabled: true,
    intervalWeeks: 1,
    frequencyInterval: 1,
    frequencyUnit: "week",
    weekday: 1,
    required: true,
  },
  photos: {
    enabled: true,
    intervalWeeks: 4,
    frequencyInterval: 4,
    frequencyUnit: "week",
    views: ["front", "side", "back"],
    required: false,
  },
  measurements: {
    enabled: true,
    intervalWeeks: 4,
    frequencyInterval: 4,
    frequencyUnit: "week",
    fields: ["waist", "chest", "hips"],
    required: false,
  },
  review: { enabled: true, intervalWeeks: 4, leadDays: 2 },
  finalEvaluation: { enabled: true },
};

const bool = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;
const boundedInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
};
const uniqueStrings = (value, allowed = null) => [
  ...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter((item) => item && (!allowed || allowed.has(item))),
  ),
];
const uniqueStringsOrFallback = (value, allowed, fallback) => {
  const normalized = uniqueStrings(value, allowed);
  return normalized.length ? normalized : [...fallback];
};

export const normalizeIntakeQuestions = (value) =>
  (Array.isArray(value) ? value : DEFAULT_INTAKE_QUESTIONS)
    .slice(0, 30)
    .map((question, index) => {
      const type = QUESTION_TYPES.includes(question?.type)
        ? question.type
        : "long_text";
      const options = ["single_choice", "multiple_choice"].includes(type)
        ? uniqueStrings(question?.options).slice(0, 12)
        : [];
      return {
        key:
          String(question?.key || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_")
            .slice(0, 50) || `question_${index + 1}`,
        label: String(question?.label || "")
          .trim()
          .slice(0, 180),
        type,
        required: bool(question?.required, false),
        enabled: bool(question?.enabled, true),
        options,
      };
    })
    .filter((question) => question.label);

export const normalizeFollowUp = (value = {}, fallback = DEFAULT_FOLLOW_UP) => {
  const cadence = ["daily", "workout_days", "weekly"].includes(
    value?.checkIn?.cadence,
  )
    ? value.checkIn.cadence
    : fallback.checkIn.cadence;
  const normalizeFrequency = (key) => {
    const unit = ["day", "week", "month"].includes(value?.[key]?.frequencyUnit)
      ? value[key].frequencyUnit
      : fallback[key].frequencyUnit || "week";
    const legacyInterval = boundedInt(
      value?.[key]?.intervalWeeks,
      fallback[key].intervalWeeks,
      1,
      12,
    );
    const rawFrequency = value?.[key]?.frequencyInterval;
    const fallbackFrequency = fallback[key].frequencyInterval;
    const legacyWasChanged =
      value?.[key]?.intervalWeeks !== undefined &&
      legacyInterval !== fallback[key].intervalWeeks;
    const frequencyInterval = boundedInt(
      unit === "week" &&
        (rawFrequency === undefined ||
          (legacyWasChanged &&
            Number(rawFrequency) === Number(fallbackFrequency)))
        ? legacyInterval
        : rawFrequency,
      fallbackFrequency || legacyInterval,
      1,
      90,
    );
    return {
      frequencyInterval,
      frequencyUnit: unit,
      intervalWeeks:
        unit === "week" ? Math.min(12, frequencyInterval) : legacyInterval,
    };
  };
  const weightFrequency = normalizeFrequency("weight");
  const photoFrequency = normalizeFrequency("photos");
  const measurementFrequency = normalizeFrequency("measurements");
  return {
    checkIn: {
      enabled: bool(value?.checkIn?.enabled, fallback.checkIn.enabled),
      cadence,
      weekdays: uniqueStrings(
        value?.checkIn?.weekdays,
        new Set(["1", "2", "3", "4", "5", "6", "7"]),
      ).map(Number),
    },
    weight: {
      enabled: bool(value?.weight?.enabled, fallback.weight.enabled),
      ...weightFrequency,
      weekday: boundedInt(
        value?.weight?.weekday,
        fallback.weight.weekday,
        1,
        7,
      ),
      required: bool(value?.weight?.required, fallback.weight.required),
    },
    photos: {
      enabled: bool(value?.photos?.enabled, fallback.photos.enabled),
      ...photoFrequency,
      views: uniqueStringsOrFallback(
        value?.photos?.views,
        new Set(["front", "side", "back", "other"]),
        fallback.photos.views,
      ),
      required: bool(value?.photos?.required, fallback.photos.required),
    },
    measurements: {
      enabled: bool(
        value?.measurements?.enabled,
        fallback.measurements.enabled,
      ),
      ...measurementFrequency,
      fields: uniqueStringsOrFallback(
        value?.measurements?.fields,
        new Set(["waist", "chest", "hips", "arm", "thigh", "calf"]),
        fallback.measurements.fields,
      ),
      required: bool(
        value?.measurements?.required,
        fallback.measurements.required,
      ),
    },
    review: {
      enabled: bool(value?.review?.enabled, fallback.review.enabled),
      intervalWeeks: boundedInt(
        value?.review?.intervalWeeks,
        fallback.review.intervalWeeks,
        1,
        12,
      ),
      leadDays: boundedInt(
        value?.review?.leadDays,
        fallback.review.leadDays,
        0,
        14,
      ),
    },
    finalEvaluation: {
      enabled: bool(
        value?.finalEvaluation?.enabled,
        fallback.finalEvaluation.enabled,
      ),
    },
  };
};

export const defaultCoachWorkflow = () => ({
  intakeQuestions: DEFAULT_INTAKE_QUESTIONS.map((question) => ({
    ...question,
  })),
  followUp: normalizeFollowUp(DEFAULT_FOLLOW_UP),
});

export const resolvePlanFollowUp = (plan, coachSettings) =>
  plan?.followUp?.useCoachDefaults === false
    ? normalizeFollowUp(plan.followUp)
    : normalizeFollowUp(coachSettings?.followUp || DEFAULT_FOLLOW_UP);

const utcDate = (value) => {
  const key =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value || "").slice(0, 10);
  const date = new Date(`${key}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isoWeekday = (date) => (date.getUTCDay() === 0 ? 7 : date.getUTCDay());

const intervalDue = (today, start, intervalWeeks, weekday = null) => {
  if (!today || !start || today < start) return false;
  const elapsedDays = Math.floor((today - start) / 86400000);
  const week = Math.floor(elapsedDays / 7);
  const targetWeekday = weekday || isoWeekday(start);
  return week % intervalWeeks === 0 && isoWeekday(today) === targetWeekday;
};

const frequencyDue = (today, start, policy, weekday = null) => {
  if (!today || !start || today < start) return false;
  const interval = Math.max(
    1,
    Number(policy?.frequencyInterval || policy?.intervalWeeks || 1),
  );
  const unit = policy?.frequencyUnit || "week";
  if (unit === "day") {
    const elapsedDays = Math.floor((today - start) / 86400000);
    return elapsedDays % interval === 0;
  }
  if (unit === "month") {
    const elapsedMonths =
      (today.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      today.getUTCMonth() -
      start.getUTCMonth();
    if (elapsedMonths < 0 || elapsedMonths % interval !== 0) return false;
    const finalDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return today.getUTCDate() === Math.min(start.getUTCDate(), finalDay);
  }
  return intervalDue(today, start, interval, weekday);
};

export const buildTrackingMissions = ({
  plan,
  followUp,
  todayKey,
  todayCheckIn,
  todayWeight,
  todayPhotos = [],
  todayMeasurement,
  finalAssessment,
}) => {
  if (!plan || !followUp) return [];
  const today = utcDate(todayKey);
  const start = utcDate(plan.startDate);
  if (!today || !start) return [];
  const missions = [];
  const dayIndex = isoWeekday(today);
  const workoutToday =
    plan.scheduleMode !== "fixed" ||
    (plan.weeklySchedule || []).some(
      (day) => day.type === "training" && Number(day.dayIndex) === dayIndex,
    );
  const checkInDue =
    followUp.checkIn.enabled &&
    (followUp.checkIn.cadence === "daily" ||
      (followUp.checkIn.cadence === "workout_days" && workoutToday) ||
      (followUp.checkIn.cadence === "weekly" &&
        dayIndex === Number(followUp.checkIn.weekdays?.[0] || 1)));
  if (checkInDue) {
    missions.push({
      id: "check_in",
      type: "check_in",
      title: "Check-in de bienestar",
      subtitle: todayCheckIn ? "Registrado hoy" : "Sueño, energía y molestias",
      required: true,
      completed: Boolean(todayCheckIn),
    });
  }
  if (
    followUp.weight.enabled &&
    frequencyDue(today, start, followUp.weight, followUp.weight.weekday)
  ) {
    missions.push({
      id: "weight",
      type: "weight",
      title: "Peso de seguimiento",
      subtitle: todayWeight
        ? `${todayWeight.weightKg} kg registrados`
        : "Registrar peso actual",
      required: followUp.weight.required,
      completed: Boolean(todayWeight),
    });
  }
  if (followUp.photos.enabled && frequencyDue(today, start, followUp.photos)) {
    const capturedViews = new Set(todayPhotos.map((photo) => photo.view));
    const pendingViews = followUp.photos.views.filter(
      (view) => !capturedViews.has(view),
    );
    missions.push({
      id: "photos",
      type: "photos",
      title: "Fotos de progreso",
      subtitle: pendingViews.length
        ? `${pendingViews.length} vista${pendingViews.length === 1 ? "" : "s"} pendiente${pendingViews.length === 1 ? "" : "s"}`
        : "Registro completado",
      required: followUp.photos.required,
      completed: pendingViews.length === 0,
      views: followUp.photos.views,
    });
  }
  if (
    followUp.measurements.enabled &&
    frequencyDue(today, start, followUp.measurements)
  ) {
    missions.push({
      id: "measurements",
      type: "measurements",
      title: "Medidas corporales",
      subtitle: todayMeasurement ? "Registradas hoy" : "Actualizar medidas",
      required: followUp.measurements.required,
      completed: Boolean(todayMeasurement),
      fields: followUp.measurements.fields,
    });
  }
  const endKey =
    plan.endDate instanceof Date
      ? plan.endDate.toISOString().slice(0, 10)
      : String(plan.endDate || "").slice(0, 10);
  if (
    followUp.finalEvaluation.enabled &&
    ((endKey && todayKey >= endKey) || plan.status === "completed")
  ) {
    missions.push({
      id: "final_evaluation",
      type: "final_evaluation",
      title: "Evaluación final del plan",
      subtitle: finalAssessment
        ? "Enviada a tu coach"
        : "Cuéntanos cómo resultó este bloque",
      required: true,
      completed: Boolean(finalAssessment),
      planId: String(plan._id || plan.id || ""),
    });
  }
  return missions;
};
