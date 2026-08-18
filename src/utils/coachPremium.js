const DAY_MS = 86_400_000;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 0) => Number(finite(value).toFixed(digits));

const dateKey = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const shiftDateKey = (value, days) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
};

const daysBetween = (from, to) => {
  if (!from || !to) return null;
  return Math.max(
    0,
    Math.floor(
      (new Date(`${to}T12:00:00.000Z`) - new Date(`${from}T12:00:00.000Z`)) /
        DAY_MS,
    ),
  );
};

const completedSets = (training = {}) => {
  if (Number.isFinite(Number(training.volumeBreakdown?.completedSets))) {
    return Number(training.volumeBreakdown.completedSets);
  }
  return (training.exercises || []).reduce(
    (sum, exercise) =>
      sum +
      (exercise.sets || []).filter(
        (set) =>
          set.done === true ||
          (set.entries || []).some((entry) => entry.done === true),
      ).length,
    0,
  );
};

const summarizeTrainings = (trainings = []) => ({
  sessions: trainings.length,
  volume: round(
    trainings.reduce((sum, item) => sum + finite(item.totalVolume), 0),
  ),
  sets: trainings.reduce((sum, item) => sum + completedSets(item), 0),
  durationMinutes: round(
    trainings.reduce((sum, item) => sum + finite(item.durationSeconds) / 60, 0),
  ),
});

const percentChange = (current, previous) => {
  if (!previous) return current ? 100 : 0;
  return round(((current - previous) / previous) * 100);
};

export const calculateReadiness = (input = {}) => {
  const sleep = clamp(finite(input.sleep), 1, 5);
  const energy = clamp(finite(input.energy), 1, 5);
  const motivation = clamp(finite(input.motivation), 1, 5);
  const stressRecovery = 6 - clamp(finite(input.stress), 1, 5);
  const sorenessRecovery = 6 - clamp(finite(input.soreness), 1, 5);
  const jointRecovery = 6 - clamp(finite(input.jointPain), 1, 5);
  const score = round(
    ((sleep * 0.22 +
      energy * 0.24 +
      motivation * 0.14 +
      stressRecovery * 0.14 +
      sorenessRecovery * 0.14 +
      jointRecovery * 0.12) /
      5) *
      100,
  );
  const state = score >= 72 ? "ready" : score >= 48 ? "adjust" : "recover";
  const recommendation =
    state === "ready"
      ? "Puede seguir la sesion planificada y progresar si la tecnica se mantiene."
      : state === "adjust"
        ? "Conviene mantener los ejercicios y reducir entre 10% y 20% el volumen o la carga."
        : "Prioriza recuperacion o una sesion ligera; evita aumentar carga mientras persistan las molestias.";
  return { score, state, recommendation };
};

export const buildWeeklyReport = ({
  athlete = {},
  trainings = [],
  activePlan = null,
  latestCheckIn = null,
  today = new Date(),
} = {}) => {
  const todayKey = dateKey(today);
  const currentFrom = shiftDateKey(todayKey, -6);
  const previousFrom = shiftDateKey(todayKey, -13);
  const previousTo = shiftDateKey(todayKey, -7);
  const currentTrainings = trainings.filter(
    (item) => item.date >= currentFrom && item.date <= todayKey,
  );
  const previousTrainings = trainings.filter(
    (item) => item.date >= previousFrom && item.date <= previousTo,
  );
  const current = summarizeTrainings(currentTrainings);
  const previous = summarizeTrainings(previousTrainings);
  const target = Math.max(
    1,
    Number(activePlan?.frequencyTarget) ||
      (activePlan?.weeklySchedule || []).filter(
        (day) => day.type === "training",
      ).length ||
      current.sessions ||
      1,
  );
  const adherence = round(Math.min(100, (current.sessions / target) * 100));
  const sorted = [...trainings].sort((a, b) => b.date.localeCompare(a.date));
  const lastTrainingDate = sorted[0]?.date || null;
  const inactiveDays = lastTrainingDate
    ? daysBetween(lastTrainingDate, todayKey)
    : null;
  const planDaysRemaining = activePlan?.endDate
    ? daysBetween(todayKey, dateKey(activePlan.endDate))
    : null;
  const alerts = [];
  if (inactiveDays === null || inactiveDays >= 7) {
    alerts.push({
      code: "inactive",
      severity: inactiveDays === null || inactiveDays >= 14 ? "high" : "medium",
      title:
        inactiveDays === null
          ? "Sin sesiones registradas"
          : `${inactiveDays} dias sin entrenar`,
      detail: "Conviene contactar al atleta y revisar barreras de adherencia.",
    });
  }
  if (activePlan && adherence < 60) {
    alerts.push({
      code: "low_adherence",
      severity: "high",
      title: `Adherencia semanal de ${adherence}%`,
      detail: `${current.sessions} de ${target} sesiones planificadas.`,
    });
  }
  if (!activePlan) {
    alerts.push({
      code: "no_plan",
      severity: "medium",
      title: "Sin planificacion activa",
      detail: "Prepara un borrador para mantener continuidad.",
    });
  } else if (planDaysRemaining !== null && planDaysRemaining <= 7) {
    alerts.push({
      code: "plan_ending",
      severity: "medium",
      title: "La planificacion finaliza pronto",
      detail: `${Math.max(0, planDaysRemaining)} dias restantes.`,
    });
  }
  if (
    latestCheckIn?.readinessState === "recover" ||
    latestCheckIn?.jointPain >= 4
  ) {
    alerts.push({
      code: "recovery",
      severity: "high",
      title: "Recuperacion comprometida",
      detail: latestCheckIn?.painAreas?.length
        ? `Molestias: ${latestCheckIn.painAreas.join(", ")}.`
        : "Revisa el ultimo check-in antes de prescribir carga.",
    });
  }

  const volumeChange = percentChange(current.volume, previous.volume);
  const sessionChange = current.sessions - previous.sessions;
  const recommendation = alerts.some((item) => item.code === "recovery")
    ? "Ajustar la proxima sesion y confirmar el estado de las molestias."
    : adherence < 60
      ? "Reducir friccion: reprogramar las sesiones pendientes y confirmar disponibilidad."
      : volumeChange > 20
        ? "La carga subio con rapidez; mantener o progresar de forma conservadora."
        : "Mantener la estructura actual y progresar solo con ejecucion estable.";

  return {
    generatedAt: new Date().toISOString(),
    period: { from: currentFrom, to: todayKey },
    athlete: {
      id: String(athlete.id || athlete._id || ""),
      name: athlete.name || "Atleta",
    },
    current,
    previous,
    comparison: {
      volumePercent: volumeChange,
      sessions: sessionChange,
      setsPercent: percentChange(current.sets, previous.sets),
    },
    adherence: { completed: current.sessions, target, percentage: adherence },
    lastTrainingDate,
    inactiveDays,
    readiness: latestCheckIn
      ? {
          score: latestCheckIn.readinessScore,
          state: latestCheckIn.readinessState,
          dateKey: latestCheckIn.dateKey,
        }
      : null,
    alerts,
    priority: alerts.some((item) => item.severity === "high")
      ? "high"
      : alerts.length
        ? "medium"
        : "normal",
    recommendation,
  };
};

const TRAINING_DAY_PRESETS = {
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

export const buildAssistedPlanDraft = ({
  athlete = {},
  routines = [],
  trainings = [],
  latestCheckIn = null,
  frequency,
  today = new Date(),
} = {}) => {
  const requestedFrequency = clamp(Math.round(finite(frequency) || 3), 2, 6);
  const trainingDays = TRAINING_DAY_PRESETS[requestedFrequency];
  const usableRoutines = routines
    .filter((routine) => routine.isArchived !== true)
    .slice(0, requestedFrequency);
  const goalMap = {
    volumen: "Hipertrofia",
    definicion: "Definicion",
    mantenimiento: "Mantenimiento",
  };
  const goal = goalMap[athlete.profile?.goal] || "General";
  const level =
    trainings.length >= 40
      ? "advanced"
      : trainings.length >= 12
        ? "intermediate"
        : "beginner";
  const lowReadiness = latestCheckIn?.readinessState === "recover";
  let routineIndex = 0;
  const weeklySchedule = Array.from({ length: 7 }, (_, index) => {
    const dayIndex = index + 1;
    const isTraining = trainingDays.includes(dayIndex);
    const routine = isTraining ? usableRoutines[routineIndex++] : null;
    return {
      slotId: `slot_${dayIndex}`,
      dayIndex,
      order: dayIndex,
      type: isTraining
        ? "training"
        : dayIndex === 4 && lowReadiness
          ? "recovery"
          : "rest",
      focus: isTraining
        ? routine?.name || `Sesion ${routineIndex}`
        : "Recuperacion",
      sourceRoutineId: routine ? String(routine._id || routine.id) : "",
    };
  });
  const startDate = dateKey(today);
  const rationale = [
    `${requestedFrequency} dias distribuidos para equilibrar estimulo y recuperacion.`,
    `Nivel ${level} inferido a partir de ${trainings.length} sesiones disponibles.`,
    usableRoutines.length
      ? `${usableRoutines.length} rutinas existentes reutilizadas como punto de partida.`
      : "Los dias quedan listos para que el coach asigne o cree rutinas.",
  ];
  if (lowReadiness)
    rationale.push("Se incluyo recuperacion activa por el ultimo check-in.");
  return {
    generatedAt: new Date().toISOString(),
    source: "rules_v1",
    rationale,
    plan: {
      name: `Plan ${goal} - ${athlete.name || "Atleta"}`,
      level,
      goal,
      durationWeeks: 8,
      startDate,
      scheduleMode: "fixed",
      weeklySchedule,
      notes: `Borrador asistido. ${rationale.join(" ")}`.slice(0, 1000),
    },
  };
};

export { dateKey, shiftDateKey };
