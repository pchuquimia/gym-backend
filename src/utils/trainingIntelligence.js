import { getEffectiveWeightKg } from "./weightConfig.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const mean = (values = []) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

const quantile = (values = [], percentile = 0.5) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const standardDeviation = (values = []) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const describe = (values = []) => {
  const valid = values.map(finite).filter((value) => Number.isFinite(value));
  const average = mean(valid);
  const deviation = standardDeviation(valid);
  return {
    count: valid.length,
    mean: round(average),
    median: round(quantile(valid, 0.5)),
    min: round(valid.length ? Math.min(...valid) : 0),
    max: round(valid.length ? Math.max(...valid) : 0),
    p25: round(quantile(valid, 0.25)),
    p75: round(quantile(valid, 0.75)),
    standardDeviation: round(deviation),
    coefficientVariation: round(average ? (deviation / average) * 100 : 0),
  };
};

const pearson = (left = [], right = []) => {
  const count = Math.min(left.length, right.length);
  if (count < 3) return null;
  const x = left.slice(0, count).map(finite);
  const y = right.slice(0, count).map(finite);
  const avgX = mean(x);
  const avgY = mean(y);
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  for (let index = 0; index < count; index += 1) {
    const deltaX = x[index] - avgX;
    const deltaY = y[index] - avgY;
    numerator += deltaX * deltaY;
    denominatorX += deltaX ** 2;
    denominatorY += deltaY ** 2;
  }
  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator ? round(numerator / denominator, 2) : null;
};

const entriesFromSet = (set = {}, weightConfig = {}) => {
  const source =
    Array.isArray(set.entries) && set.entries.length ? set.entries : [set];
  return source
    .map((entry) => ({
      weight: getEffectiveWeightKg(
        entry.weightKg ?? entry.weight ?? entry.kg,
        weightConfig,
      ),
      reps: finite(entry.reps ?? entry.repetitions),
      done: entry.done,
    }))
    .filter((entry) => entry.weight > 0 && entry.reps > 0);
};

const estimateOneRM = (weight, reps) => {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, 30) / 30);
};

const sessionMetric = (training = {}) => {
  let calculatedVolume = 0;
  let sets = 0;
  let reps = 0;
  let bestOneRM = 0;
  let observations = 0;

  (training.exercises || []).forEach((exercise) => {
    (exercise.sets || []).forEach((set) => {
      const entries = entriesFromSet(set, exercise);
      if (!entries.length) return;
      sets += 1;
      entries.forEach((entry) => {
        calculatedVolume += entry.weight * entry.reps;
        reps += entry.reps;
        observations += 1;
        bestOneRM = Math.max(
          bestOneRM,
          estimateOneRM(entry.weight, entry.reps),
        );
      });
    });
  });

  const volume = calculatedVolume || finite(training.totalVolume);
  const durationMinutes = finite(training.durationSeconds) / 60;
  const completenessChecks = [
    Boolean(training.date),
    (training.exercises || []).length > 0,
    sets > 0,
    volume > 0,
    durationMinutes > 0,
  ];

  return {
    id: String(training._id || training.id || ""),
    date: String(training.date || "").slice(0, 10),
    routineName: training.routineName || "Entrenamiento",
    volume: round(volume, 0),
    sets,
    reps,
    exercises: (training.exercises || []).length,
    durationMinutes: round(durationMinutes),
    bestOneRM: round(bestOneRM),
    observations,
    completeness:
      completenessChecks.filter(Boolean).length / completenessChecks.length,
  };
};

const mondayKey = (dateValue) => {
  const date = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
};

const addDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const buildWeeklySeries = (sessions = []) => {
  const map = new Map();
  sessions.forEach((session) => {
    const key = mondayKey(session.date);
    if (!key) return;
    const current = map.get(key) || {
      week: key,
      volume: 0,
      sets: 0,
      durationMinutes: 0,
      sessions: 0,
      bestOneRM: 0,
    };
    current.volume += session.volume;
    current.sets += session.sets;
    current.durationMinutes += session.durationMinutes;
    current.sessions += 1;
    current.bestOneRM = Math.max(current.bestOneRM, session.bestOneRM);
    map.set(key, current);
  });
  const keys = [...map.keys()].sort();
  if (!keys.length) return [];
  const filled = [];
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  while (cursor <= last && filled.length < 260) {
    filled.push(
      map.get(cursor) || {
        week: cursor,
        volume: 0,
        sets: 0,
        durationMinutes: 0,
        sessions: 0,
        bestOneRM: 0,
      },
    );
    cursor = addDays(cursor, 7);
  }
  return filled.slice(-52).map((item) => ({
    ...item,
    volume: round(item.volume, 0),
    durationMinutes: round(item.durationMinutes),
    bestOneRM: round(item.bestOneRM),
  }));
};

const linearPrediction = (series = []) => {
  const points = series.slice(-16);
  if (points.length < 3) {
    return {
      available: false,
      reason: "Se necesitan al menos 3 semanas de historial",
      sampleSize: points.length,
    };
  }
  const x = points.map((_, index) => index);
  const y = points.map((item) => finite(item.volume));
  const avgX = mean(x);
  const avgY = mean(y);
  const numerator = x.reduce(
    (sum, value, index) => sum + (value - avgX) * (y[index] - avgY),
    0,
  );
  const denominator = x.reduce((sum, value) => sum + (value - avgX) ** 2, 0);
  const slope = denominator ? numerator / denominator : 0;
  const intercept = avgY - slope * avgX;
  const fitted = x.map((value) => intercept + slope * value);
  const residuals = y.map((value, index) => value - fitted[index]);
  const residualDeviation = standardDeviation(residuals);
  const totalVariance = y.reduce((sum, value) => sum + (value - avgY) ** 2, 0);
  const residualVariance = residuals.reduce(
    (sum, value) => sum + value ** 2,
    0,
  );
  const r2 = totalVariance
    ? Math.max(0, 1 - residualVariance / totalVariance)
    : 0;
  const forecast = Math.max(0, intercept + slope * points.length);
  const interval = residualDeviation * 1.28;
  return {
    available: true,
    method: "Regresion lineal",
    sampleSize: points.length,
    nextWeekVolume: round(forecast, 0),
    lower80: round(Math.max(0, forecast - interval), 0),
    upper80: round(forecast + interval, 0),
    slopePerWeek: round(slope, 0),
    trendPercent: round(avgY ? (slope / avgY) * 100 : 0),
    r2: round(r2, 2),
    confidence: r2 >= 0.65 ? "alta" : r2 >= 0.35 ? "media" : "baja",
  };
};

const detectAnomalies = (sessions = []) => {
  if (sessions.length < 5) return [];
  const volumes = sessions.map((item) => item.volume);
  const average = mean(volumes);
  const deviation = standardDeviation(volumes);
  if (!deviation) return [];
  return sessions
    .map((session) => ({
      id: session.id,
      date: session.date,
      routineName: session.routineName,
      volume: session.volume,
      zScore: round((session.volume - average) / deviation, 2),
    }))
    .filter((item) => Math.abs(item.zScore) >= 1.8)
    .sort((left, right) => Math.abs(right.zScore) - Math.abs(left.zScore))
    .slice(0, 8)
    .map((item) => ({
      ...item,
      direction: item.zScore > 0 ? "alta" : "baja",
    }));
};

const distance = (left, right) =>
  Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0),
  );

const clusterSessions = (sessions = []) => {
  if (sessions.length < 6) {
    return {
      available: false,
      sampleSize: sessions.length,
      reason: "Se necesitan al menos 6 sesiones",
      clusters: [],
    };
  }
  const raw = sessions.map((session) => [
    session.volume,
    session.sets,
    session.durationMinutes,
  ]);
  const means = [0, 1, 2].map((index) => mean(raw.map((row) => row[index])));
  const deviations = [0, 1, 2].map(
    (index) => standardDeviation(raw.map((row) => row[index])) || 1,
  );
  const points = raw.map((row) =>
    row.map((value, index) => (value - means[index]) / deviations[index]),
  );
  const ranked = points
    .map((point, index) => ({ point, index, volume: raw[index][0] }))
    .sort((left, right) => left.volume - right.volume);
  let centroids = [0.15, 0.5, 0.85].map(
    (position) =>
      ranked[
        Math.min(ranked.length - 1, Math.floor((ranked.length - 1) * position))
      ].point,
  );
  let assignments = new Array(points.length).fill(0);
  for (let iteration = 0; iteration < 15; iteration += 1) {
    assignments = points.map((point) => {
      const distances = centroids.map((centroid) => distance(point, centroid));
      return distances.indexOf(Math.min(...distances));
    });
    centroids = centroids.map((centroid, clusterIndex) => {
      const members = points.filter(
        (_, index) => assignments[index] === clusterIndex,
      );
      if (!members.length) return centroid;
      return centroid.map((_, featureIndex) =>
        mean(members.map((member) => member[featureIndex])),
      );
    });
  }
  const summaries = centroids.map((_, clusterIndex) => {
    const members = sessions.filter(
      (__, index) => assignments[index] === clusterIndex,
    );
    return {
      internalId: clusterIndex,
      count: members.length,
      averageVolume: round(mean(members.map((item) => item.volume)), 0),
      averageSets: round(mean(members.map((item) => item.sets))),
      averageDuration: round(mean(members.map((item) => item.durationMinutes))),
    };
  });
  const ordered = summaries.sort(
    (left, right) => left.averageVolume - right.averageVolume,
  );
  const labels = ["Carga baja", "Carga moderada", "Carga alta"];
  return {
    available: true,
    method: "K-means (3 grupos)",
    sampleSize: sessions.length,
    clusters: ordered.map((item, index) => ({
      ...item,
      label: labels[index],
      share: round((item.count / sessions.length) * 100, 0),
    })),
  };
};

const daysBetweenKeys = (from, to) => {
  if (!from || !to) return null;
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
};

const sumVolume = (sessions = []) =>
  sessions.reduce((sum, session) => sum + finite(session.volume), 0);

const buildDecisionSupport = (
  sessions = [],
  { checkIns = [], weighIns = [], activePlan = null, profile = {}, today } = {},
) => {
  const todayKey = String(today || new Date().toISOString()).slice(0, 10);
  const acuteFrom = addDays(todayKey, -6);
  const chronicFrom = addDays(todayKey, -34);
  const chronicTo = addDays(todayKey, -7);
  const acuteSessions = sessions.filter(
    (session) => session.date >= acuteFrom && session.date <= todayKey,
  );
  const chronicSessions = sessions.filter(
    (session) => session.date >= chronicFrom && session.date <= chronicTo,
  );
  const acuteVolume = sumVolume(acuteSessions);
  const chronicWeeklyVolume = sumVolume(chronicSessions) / 4;
  const loadRatio = chronicWeeklyVolume
    ? round(acuteVolume / chronicWeeklyVolume, 2)
    : null;

  const uniqueDates = [...new Set(sessions.map((session) => session.date))]
    .filter(Boolean)
    .sort()
    .reverse();
  let consecutiveDays = 0;
  if (uniqueDates[0] && daysBetweenKeys(uniqueDates[0], todayKey) <= 1) {
    let cursor = uniqueDates[0];
    const dateSet = new Set(uniqueDates);
    while (dateSet.has(cursor)) {
      consecutiveDays += 1;
      cursor = addDays(cursor, -1);
    }
  }

  const sortedCheckIns = [...checkIns].sort((left, right) =>
    String(right.dateKey || "").localeCompare(String(left.dateKey || "")),
  );
  const latestCheckIn = sortedCheckIns[0] || null;
  const checkInAge = latestCheckIn
    ? daysBetweenKeys(latestCheckIn.dateKey, todayKey)
    : null;
  const freshCheckIn = checkInAge !== null && checkInAge <= 3;
  let score = freshCheckIn ? finite(latestCheckIn.readinessScore) : 72;
  const factors = [];

  if (freshCheckIn) {
    factors.push({
      code: "check_in",
      label: "Check-in reciente",
      tone:
        latestCheckIn.readinessState === "recover"
          ? "negative"
          : latestCheckIn.readinessState === "adjust"
            ? "warning"
            : "positive",
      detail: `${latestCheckIn.readinessScore}/100 registrado hace ${checkInAge} ${checkInAge === 1 ? "dia" : "dias"}.`,
    });
  } else {
    factors.push({
      code: "missing_check_in",
      label: "Sin check-in reciente",
      tone: "neutral",
      detail: "Completa el estado diario para personalizar la recomendacion.",
    });
  }

  if (loadRatio !== null) {
    if (loadRatio > 1.5) {
      score -= 20;
      factors.push({
        code: "load_spike",
        label: "Aumento brusco de carga",
        tone: "negative",
        detail: `La carga de 7 dias equivale al ${round(loadRatio * 100, 0)}% del promedio semanal previo.`,
      });
    } else if (loadRatio > 1.3) {
      score -= 12;
      factors.push({
        code: "load_high",
        label: "Carga por encima del patron",
        tone: "warning",
        detail: `La carga reciente esta ${round((loadRatio - 1) * 100, 0)}% sobre el promedio previo.`,
      });
    } else if (loadRatio >= 0.75 && loadRatio <= 1.2) {
      factors.push({
        code: "load_stable",
        label: "Carga estable",
        tone: "positive",
        detail:
          "La carga reciente se mantiene cerca del patron de cuatro semanas.",
      });
    } else if (loadRatio < 0.6) {
      factors.push({
        code: "load_drop",
        label: "Caida de carga",
        tone: "warning",
        detail:
          "La actividad reciente esta claramente por debajo del patron habitual.",
      });
    }
  }

  if (consecutiveDays >= 4) {
    score -= 10;
    factors.push({
      code: "consecutive_days",
      label: "Acumulacion de sesiones",
      tone: "warning",
      detail: `${consecutiveDays} dias consecutivos con entrenamiento registrado.`,
    });
  }

  if (freshCheckIn && finite(latestCheckIn.jointPain) >= 4) {
    score = Math.min(score, 42);
    factors.push({
      code: "joint_pain",
      label: "Molestia articular elevada",
      tone: "negative",
      detail: latestCheckIn.painAreas?.length
        ? `Zonas informadas: ${latestCheckIn.painAreas.join(", ")}.`
        : "Evita progresar carga hasta revisar la molestia.",
    });
  }

  const sortedWeighIns = [...weighIns].sort((left, right) =>
    String(left.dateKey || "").localeCompare(String(right.dateKey || "")),
  );
  const recentWeight = sortedWeighIns.filter(
    (entry) => entry.dateKey >= addDays(todayKey, -30),
  );
  const firstWeight = recentWeight[0]?.weightKg;
  const lastWeight = recentWeight[recentWeight.length - 1]?.weightKg;
  const weightChangePercent =
    firstWeight && lastWeight
      ? round(((lastWeight - firstWeight) / firstWeight) * 100, 1)
      : null;
  if (
    weightChangePercent !== null &&
    weightChangePercent <= -2.5 &&
    profile.goal !== "definicion"
  ) {
    score -= 8;
    factors.push({
      code: "weight_drop",
      label: "Descenso rapido de peso",
      tone: "warning",
      detail: `${weightChangePercent}% durante los ultimos 30 dias.`,
    });
  }

  score = Math.max(0, Math.min(100, round(score, 0)));
  const state = score >= 75 ? "optimal" : score >= 50 ? "caution" : "recovery";
  const recommendation =
    state === "optimal"
      ? "Mantener la sesion planificada. Progresa solo si la tecnica y el esfuerzo se mantienen estables."
      : state === "caution"
        ? "Mantener los ejercicios y reducir entre 10% y 20% el volumen o la carga prevista."
        : "Priorizar recuperacion o una sesion ligera y evitar aumentos de carga hasta que mejoren las señales.";
  const adjustment =
    state === "optimal"
      ? { minPercent: 0, maxPercent: 5 }
      : state === "caution"
        ? { minPercent: -20, maxPercent: -10 }
        : { minPercent: -40, maxPercent: -25 };

  const weekStart = mondayKey(todayKey);
  const sessionsThisWeek = sessions.filter(
    (session) => session.date >= weekStart && session.date <= todayKey,
  ).length;
  const target = Number(activePlan?.frequencyTarget) || null;
  const confidenceSources = [
    freshCheckIn,
    chronicSessions.length >= 4,
    recentWeight.length >= 2,
    Boolean(activePlan),
  ].filter(Boolean).length;

  return {
    generatedFor: todayKey,
    score,
    state,
    confidence:
      confidenceSources >= 3
        ? "alta"
        : confidenceSources >= 2
          ? "media"
          : "baja",
    recommendation,
    adjustment,
    factors,
    load: {
      acuteVolume: round(acuteVolume, 0),
      chronicWeeklyVolume: round(chronicWeeklyVolume, 0),
      ratio: loadRatio,
      sessionsLast7Days: acuteSessions.length,
      consecutiveDays,
    },
    adherence: {
      completed: sessionsThisWeek,
      target,
      percentage: target
        ? round(Math.min(100, (sessionsThisWeek / target) * 100), 0)
        : null,
    },
    weight: {
      currentKg: lastWeight || null,
      change30dPercent: weightChangePercent,
      observations: recentWeight.length,
    },
    latestCheckIn: latestCheckIn
      ? {
          dateKey: latestCheckIn.dateKey,
          score: latestCheckIn.readinessScore,
          state: latestCheckIn.readinessState,
        }
      : null,
  };
};

const exerciseKey = (exercise = {}) =>
  String(exercise.exerciseId || exercise.exerciseName || "")
    .trim()
    .toLowerCase();

const roundToHalf = (value) => Math.round(finite(value) * 2) / 2;

const buildExerciseProgression = (trainings = [], readiness = null) => {
  const exerciseMap = new Map();
  [...trainings]
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .forEach((training) => {
      (training.exercises || []).forEach((exercise) => {
        const key = exerciseKey(exercise);
        if (!key) return;
        const entries = (exercise.sets || [])
          .flatMap((set) => entriesFromSet(set, exercise))
          .filter((entry) => entry.done !== false);
        if (!entries.length) return;
        const best = entries.reduce((current, entry) => {
          const oneRM = estimateOneRM(entry.weight, entry.reps);
          return !current || oneRM > current.oneRM
            ? { ...entry, oneRM }
            : current;
        }, null);
        const observation = {
          date: String(training.date || "").slice(0, 10),
          oneRM: round(best.oneRM),
          weight: round(best.weight),
          reps: best.reps,
          volume: round(
            entries.reduce((sum, entry) => sum + entry.weight * entry.reps, 0),
            0,
          ),
        };
        const current = exerciseMap.get(key) || {
          exerciseId: exercise.exerciseId || key,
          name: exercise.exerciseName || "Ejercicio",
          muscleGroup:
            exercise.primaryMuscleGroup || exercise.muscleGroup || "General",
          history: [],
        };
        current.history.push(observation);
        exerciseMap.set(key, current);
      });
    });

  const priority = {
    declining: 0,
    plateau: 1,
    progressing: 2,
    stable: 3,
    limited: 4,
  };
  const items = [...exerciseMap.values()]
    .map((exercise) => {
      const history = exercise.history.slice(-12);
      const latest = history[history.length - 1];
      const previous = history.slice(-4, -1);
      const baseline = mean(previous.map((item) => item.oneRM));
      const changePercent = baseline
        ? round(((latest.oneRM - baseline) / baseline) * 100, 1)
        : null;
      const recentFour = history.slice(-4).map((item) => item.oneRM);
      const recentAverage = mean(recentFour);
      const recentRange = recentFour.length
        ? Math.max(...recentFour) - Math.min(...recentFour)
        : 0;
      const plateau =
        recentFour.length >= 4 &&
        recentAverage > 0 &&
        recentRange / recentAverage <= 0.025;
      const status =
        history.length < 3
          ? "limited"
          : changePercent <= -5
            ? "declining"
            : plateau
              ? "plateau"
              : changePercent >= 2.5
                ? "progressing"
                : "stable";
      let suggestion =
        "Mantener la carga y buscar una repeticion adicional con tecnica estable.";
      let suggestedWeightKg = latest.weight;
      if (status === "progressing") {
        suggestion =
          "La tendencia es positiva. Consolida una sesion antes de volver a aumentar la carga.";
      } else if (status === "plateau") {
        const canIncrease = readiness?.state === "optimal";
        suggestedWeightKg = canIncrease
          ? roundToHalf(latest.weight * 1.025)
          : latest.weight;
        suggestion = canIncrease
          ? `Prueba ${suggestedWeightKg} kg manteniendo el rango actual de repeticiones.`
          : "Mantiene la carga y suma una repeticion antes de progresar peso.";
      } else if (status === "declining") {
        suggestedWeightKg = roundToHalf(latest.weight * 0.925);
        suggestion = `Considera ${suggestedWeightKg} kg y revisa recuperacion, tecnica y orden del ejercicio.`;
      } else if (status === "limited") {
        suggestion =
          "Registra al menos tres sesiones para habilitar una recomendacion de progresion.";
      }
      return {
        ...exercise,
        history,
        sessionCount: history.length,
        lastDate: latest.date,
        current: {
          oneRM: latest.oneRM,
          weight: latest.weight,
          reps: latest.reps,
        },
        bestOneRM: round(Math.max(...history.map((item) => item.oneRM))),
        changePercent,
        status,
        confidence:
          history.length >= 6 ? "alta" : history.length >= 4 ? "media" : "baja",
        suggestedWeightKg,
        suggestion,
      };
    })
    .sort(
      (left, right) =>
        priority[left.status] - priority[right.status] ||
        right.lastDate.localeCompare(left.lastDate) ||
        right.sessionCount - left.sessionCount,
    )
    .slice(0, 12);

  return {
    available: items.some((item) => item.sessionCount >= 3),
    exercisesAnalyzed: items.length,
    actionable: items.filter((item) =>
      ["declining", "plateau", "progressing"].includes(item.status),
    ).length,
    items,
  };
};

const comparisonMetric = (
  current,
  previous,
  available = true,
  referenceAvailable = available,
) => {
  const currentValue = round(current, 1);
  const previousValue = round(previous, 1);
  const hasReference =
    available && referenceAvailable && previousValue > 0;
  const changePercent = hasReference
    ? round(((currentValue - previousValue) / previousValue) * 100, 1)
    : null;
  return {
    available,
    hasReference,
    current: currentValue,
    previous: previousValue,
    delta: available ? round(currentValue - previousValue, 1) : null,
    changePercent,
    trend:
      changePercent === null
        ? "no_reference"
        : changePercent > 1
          ? "up"
          : changePercent < -1
            ? "down"
            : "stable",
  };
};

const periodExerciseBests = (trainings = [], from, to) => {
  const bests = new Map();
  trainings
    .filter((training) => {
      const date = String(training.date || "").slice(0, 10);
      return date >= from && date <= to;
    })
    .forEach((training) => {
      (training.exercises || []).forEach((exercise) => {
        const key = exerciseKey(exercise);
        if (!key) return;
        (exercise.sets || [])
          .flatMap((set) => entriesFromSet(set, exercise))
          .filter((entry) => entry.done !== false)
          .forEach((entry) => {
            const oneRM = estimateOneRM(entry.weight, entry.reps);
            if (oneRM > finite(bests.get(key))) bests.set(key, oneRM);
          });
      });
    });
  return bests;
};

const elapsedPlanTarget = (activePlan, from, to) => {
  if (!activePlan) return null;
  const planFrom = String(activePlan.startDate || "").slice(0, 10);
  const planTo = String(activePlan.endDate || "").slice(0, 10);
  if ((planFrom && planFrom > to) || (planTo && planTo < from)) return null;
  const activeFrom = planFrom && planFrom > from ? planFrom : from;
  const activeTo = planTo && planTo < to ? planTo : to;
  const firstDayIndex = daysBetweenKeys(from, activeFrom) + 1;
  const lastDayIndex = daysBetweenKeys(from, activeTo) + 1;
  const activeDays = Math.max(0, lastDayIndex - firstDayIndex + 1);
  if (!activeDays) return null;
  const schedule = Array.isArray(activePlan.weeklySchedule)
    ? activePlan.weeklySchedule
    : [];
  if (activePlan.scheduleMode === "fixed" && schedule.length) {
    return schedule.filter(
      (day) =>
        day.type === "training" &&
        Number(day.dayIndex) >= firstDayIndex &&
        Number(day.dayIndex) <= lastDayIndex,
    ).length;
  }
  const frequency = finite(activePlan.frequencyTarget);
  if (!frequency) return null;
  return Math.max(1, Math.ceil((frequency * activeDays) / 7));
};

const buildPeriodComparison = (
  trainings = [],
  sessions = [],
  { checkIns = [], activePlan = null, today } = {},
) => {
  const todayKey = String(today || new Date().toISOString()).slice(0, 10);
  const currentFrom = mondayKey(todayKey);
  const elapsedDays = Math.max(
    1,
    Math.min(7, daysBetweenKeys(currentFrom, todayKey) + 1),
  );
  const previousFrom = addDays(currentFrom, -7);
  const previousTo = addDays(todayKey, -7);
  const within = (value, from, to) => value >= from && value <= to;
  const currentSessions = sessions.filter((session) =>
    within(session.date, currentFrom, todayKey),
  );
  const previousSessions = sessions.filter((session) =>
    within(session.date, previousFrom, previousTo),
  );
  const currentVolume = sumVolume(currentSessions);
  const previousVolume = sumVolume(previousSessions);

  const currentBests = periodExerciseBests(
    trainings,
    currentFrom,
    todayKey,
  );
  const previousBests = periodExerciseBests(
    trainings,
    previousFrom,
    previousTo,
  );
  const comparableExerciseKeys = [...currentBests.keys()].filter(
    (key) => previousBests.has(key) && finite(previousBests.get(key)) > 0,
  );
  const strengthRatios = comparableExerciseKeys.map(
    (key) => currentBests.get(key) / previousBests.get(key),
  );
  const strengthChange = strengthRatios.length
    ? round((quantile(strengthRatios, 0.5) - 1) * 100, 1)
    : null;
  const strength = {
    available: comparableExerciseKeys.length > 0,
    hasReference: comparableExerciseKeys.length > 0,
    current: comparableExerciseKeys.length
      ? round(mean(comparableExerciseKeys.map((key) => currentBests.get(key))))
      : null,
    previous: comparableExerciseKeys.length
      ? round(
          mean(comparableExerciseKeys.map((key) => previousBests.get(key))),
        )
      : null,
    delta: strengthChange,
    changePercent: strengthChange,
    trend:
      strengthChange === null
        ? "no_reference"
        : strengthChange > 1
          ? "up"
          : strengthChange < -1
            ? "down"
            : "stable",
    comparableExercises: comparableExerciseKeys.length,
  };

  const currentTarget = elapsedPlanTarget(activePlan, currentFrom, todayKey);
  const previousTarget = elapsedPlanTarget(
    activePlan,
    previousFrom,
    previousTo,
  );
  const adherenceAvailable =
    Number.isFinite(currentTarget) && currentTarget > 0;
  const adherenceReferenceAvailable =
    Number.isFinite(previousTarget) && previousTarget > 0;
  const adherence = comparisonMetric(
    adherenceAvailable
      ? Math.min(100, (currentSessions.length / currentTarget) * 100)
      : 0,
    adherenceReferenceAvailable
      ? Math.min(100, (previousSessions.length / previousTarget) * 100)
      : 0,
    adherenceAvailable,
    adherenceReferenceAvailable,
  );
  adherence.target = adherenceAvailable ? currentTarget : null;
  adherence.previousTarget = adherenceReferenceAvailable
    ? previousTarget
    : null;
  adherence.currentCompleted = currentSessions.length;
  adherence.previousCompleted = previousSessions.length;

  const readinessValues = (from, to) =>
    checkIns
      .filter((entry) => within(String(entry.dateKey || ""), from, to))
      .map((entry) => finite(entry.readinessScore))
      .filter((value) => value > 0);
  const currentReadiness = readinessValues(currentFrom, todayKey);
  const previousReadiness = readinessValues(previousFrom, previousTo);
  const recoveryAvailable = currentReadiness.length > 0;
  const recoveryReferenceAvailable = previousReadiness.length > 0;
  const recovery = comparisonMetric(
    mean(currentReadiness),
    mean(previousReadiness),
    recoveryAvailable,
    recoveryReferenceAvailable,
  );
  recovery.currentObservations = currentReadiness.length;
  recovery.previousObservations = previousReadiness.length;

  return {
    period: {
      current: { from: currentFrom, to: todayKey },
      previous: { from: previousFrom, to: previousTo },
      elapsedDays,
      comparisonMode: "equivalent_weekdays",
    },
    metrics: {
      sessions: comparisonMetric(
        currentSessions.length,
        previousSessions.length,
      ),
      volume: comparisonMetric(currentVolume, previousVolume),
      strength,
      adherence,
      recovery,
    },
  };
};

export const buildTrainingIntelligence = (trainings = [], options = {}) => {
  const sessions = trainings
    .map(sessionMetric)
    .filter((session) => session.date)
    .sort((left, right) => left.date.localeCompare(right.date));
  const weekly = buildWeeklySeries(sessions);
  const volumeStats = describe(sessions.map((item) => item.volume));
  const durationStats = describe(sessions.map((item) => item.durationMinutes));
  const setStats = describe(sessions.map((item) => item.sets));
  const completeness = sessions.length
    ? mean(sessions.map((item) => item.completeness)) * 100
    : 0;
  const setEntries = sessions.reduce((sum, item) => sum + item.observations, 0);
  const prediction = linearPrediction(weekly);
  const clusters = clusterSessions(sessions);
  const minDeepLearningSessions = 200;
  const sequenceCoverage = sessions.length
    ? (sessions.filter(
        (item) => item.volume > 0 && item.durationMinutes > 0 && item.sets > 0,
      ).length /
        sessions.length) *
      100
    : 0;
  const advancedEnabled = options.advanced === true;
  const decisionSupport = advancedEnabled
    ? buildDecisionSupport(sessions, options.context)
    : null;
  const exerciseProgression = advancedEnabled
    ? buildExerciseProgression(trainings, decisionSupport)
    : null;
  const periodComparison = advancedEnabled
    ? buildPeriodComparison(trainings, sessions, options.context)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      sessions: sessions.length,
      setEntries,
      exerciseObservations: sessions.reduce(
        (sum, item) => sum + item.exercises,
        0,
      ),
      firstDate: sessions[0]?.date || null,
      lastDate: sessions[sessions.length - 1]?.date || null,
      completeness: round(completeness, 0),
      processedOn: "server",
      recordLimit: options.recordLimit || 2000,
    },
    totals: {
      volume: round(
        sessions.reduce((sum, item) => sum + item.volume, 0),
        0,
      ),
      sets: sessions.reduce((sum, item) => sum + item.sets, 0),
      durationMinutes: round(
        sessions.reduce((sum, item) => sum + item.durationMinutes, 0),
        0,
      ),
    },
    descriptive: {
      volume: volumeStats,
      duration: durationStats,
      sets: setStats,
      correlations: {
        volumeDuration: pearson(
          sessions.map((item) => item.volume),
          sessions.map((item) => item.durationMinutes),
        ),
        volumeSets: pearson(
          sessions.map((item) => item.volume),
          sessions.map((item) => item.sets),
        ),
      },
    },
    weekly,
    prediction,
    anomalies: detectAnomalies(sessions),
    machineLearning: clusters,
    advanced: {
      available: advancedEnabled,
      requiresPremium: !advancedEnabled,
      decisionSupport,
      exerciseProgression,
      periodComparison,
    },
    deepLearning: {
      ready:
        sessions.length >= minDeepLearningSessions && sequenceCoverage >= 85,
      currentSessions: sessions.length,
      requiredSessions: minDeepLearningSessions,
      sequenceCoverage: round(sequenceCoverage, 0),
      readiness: round(
        Math.min(70, (sessions.length / minDeepLearningSessions) * 70) +
          Math.min(30, sequenceCoverage * 0.3),
        0,
      ),
      modelType: "Serie temporal multivariable",
    },
    infrastructure: {
      aggregation: "API Node.js",
      storage: options.storage || "MongoDB",
      delivery: "JSON agregado",
      rawRowsSent: 0,
    },
  };
};
