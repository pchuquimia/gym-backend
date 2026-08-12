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
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

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
  const source = Array.isArray(set.entries) && set.entries.length
    ? set.entries
    : [set];
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
        bestOneRM = Math.max(bestOneRM, estimateOneRM(entry.weight, entry.reps));
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
    completeness: completenessChecks.filter(Boolean).length / completenessChecks.length,
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
  const residualVariance = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const r2 = totalVariance ? Math.max(0, 1 - residualVariance / totalVariance) : 0;
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
  Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0));

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
    (position) => ranked[Math.min(ranked.length - 1, Math.floor((ranked.length - 1) * position))].point,
  );
  let assignments = new Array(points.length).fill(0);
  for (let iteration = 0; iteration < 15; iteration += 1) {
    assignments = points.map((point) => {
      const distances = centroids.map((centroid) => distance(point, centroid));
      return distances.indexOf(Math.min(...distances));
    });
    centroids = centroids.map((centroid, clusterIndex) => {
      const members = points.filter((_, index) => assignments[index] === clusterIndex);
      if (!members.length) return centroid;
      return centroid.map((_, featureIndex) =>
        mean(members.map((member) => member[featureIndex])),
      );
    });
  }
  const summaries = centroids.map((_, clusterIndex) => {
    const members = sessions.filter((__, index) => assignments[index] === clusterIndex);
    return {
      internalId: clusterIndex,
      count: members.length,
      averageVolume: round(mean(members.map((item) => item.volume)), 0),
      averageSets: round(mean(members.map((item) => item.sets))),
      averageDuration: round(mean(members.map((item) => item.durationMinutes))),
    };
  });
  const ordered = summaries.sort((left, right) => left.averageVolume - right.averageVolume);
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
    ? (sessions.filter((item) => item.volume > 0 && item.durationMinutes > 0 && item.sets > 0).length /
        sessions.length) *
      100
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      sessions: sessions.length,
      setEntries,
      exerciseObservations: sessions.reduce((sum, item) => sum + item.exercises, 0),
      firstDate: sessions[0]?.date || null,
      lastDate: sessions[sessions.length - 1]?.date || null,
      completeness: round(completeness, 0),
      processedOn: "server",
      recordLimit: options.recordLimit || 2000,
    },
    totals: {
      volume: round(sessions.reduce((sum, item) => sum + item.volume, 0), 0),
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
    deepLearning: {
      ready: sessions.length >= minDeepLearningSessions && sequenceCoverage >= 85,
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
