import { buildTrainingIntelligence } from "../src/utils/trainingIntelligence.js";

const training = ({ id, date, weight = 80, reps = 8, volume = 1000 }) => ({
  _id: id,
  date,
  routineName: "Torso",
  durationSeconds: 3600,
  totalVolume: volume,
  exercises: [
    {
      exerciseId: "bench-press",
      exerciseName: "Press banca",
      primaryMuscleGroup: "Pecho",
      loadType: "external",
      weightBasis: "total",
      sets: [{ weightKg: weight, reps, done: true }],
    },
  ],
});

describe("trainingIntelligence", () => {
  test("combina check-in, carga y plan en una recomendacion explicable", () => {
    const trainings = [
      training({ id: "t1", date: "2026-07-18", volume: 800 }),
      training({ id: "t2", date: "2026-07-25", volume: 900 }),
      training({ id: "t3", date: "2026-08-01", volume: 1000 }),
      training({ id: "t4", date: "2026-08-10", volume: 2400 }),
      training({ id: "t5", date: "2026-08-12", volume: 2200 }),
      training({ id: "t6", date: "2026-08-14", volume: 2100 }),
    ];
    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: {
        today: "2026-08-17",
        activePlan: { frequencyTarget: 4 },
        checkIns: [
          {
            dateKey: "2026-08-17",
            readinessScore: 58,
            readinessState: "recover",
            jointPain: 5,
            painAreas: ["hombro"],
          },
        ],
        weighIns: [],
        profile: { goal: "volumen" },
      },
    });

    expect(result.advanced.decisionSupport).toMatchObject({
      state: "recovery",
      adherence: { target: 4 },
    });
    expect(
      result.advanced.decisionSupport.factors.map((factor) => factor.code),
    ).toEqual(expect.arrayContaining(["load_spike", "joint_pain"]));
    expect(result.advanced.decisionSupport.recommendation).toMatch(
      /recuperaci[oó]n/i,
    );
    expect(result.advanced.decisionSupport.load.basis).toMatchObject({
      metric: "external_volume",
      unit: "kg",
    });
  });

  test("usa series para carga mixta y no interpreta asistencia como tonelaje", () => {
    const trainings = [
      ["2026-08-01", 80],
      ["2026-08-08", 60],
      ["2026-08-15", 40],
      ["2026-08-22", 20],
      ["2026-08-29", 120],
    ].map(([date, assistance], index) => {
      const item = training({
        id: `assistance-load-${index}`,
        date,
        weight: assistance,
        reps: 8,
      });
      item.exercises[0].exerciseName = "Dominada asistida";
      item.exercises[0].loadType = "assisted";
      return item;
    });

    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-08-31" },
    });
    const decision = result.advanced.decisionSupport;

    expect(decision.load).toMatchObject({
      basis: { metric: "completed_sets", unit: "series" },
      acuteValue: 1,
      chronicWeeklyValue: 1,
      acuteVolume: null,
      ratio: 1,
    });
    expect(decision.factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "load_stable" }),
      ]),
    );
  });

  test("detecta estancamiento y genera una accion por ejercicio", () => {
    const result = buildTrainingIntelligence(
      [
        training({ id: "t1", date: "2026-07-20" }),
        training({ id: "t2", date: "2026-07-27" }),
        training({ id: "t3", date: "2026-08-03" }),
        training({ id: "t4", date: "2026-08-10" }),
      ],
      {
        advanced: true,
        context: {
          today: "2026-08-10",
          checkIns: [
            {
              dateKey: "2026-08-10",
              readinessScore: 90,
              readinessState: "ready",
              jointPain: 1,
            },
          ],
        },
      },
    );

    const press = result.advanced.exerciseProgression.items[0];
    expect(press).toMatchObject({
      name: "Press banca",
      sessionCount: 4,
      status: "plateau",
    });
    expect(press.suggestion).toMatch(/repeticion|kg/i);
    expect(press.history).toHaveLength(4);
  });

  test("ignora series no completadas al calcular carga y fuerza", () => {
    const completedOnly = training({
      id: "completed-only",
      date: "2026-08-10",
      weight: 80,
      reps: 8,
      volume: 9999,
    });
    completedOnly.exercises[0].sets.push({
      weightKg: 300,
      reps: 10,
      done: false,
    });

    const result = buildTrainingIntelligence([completedOnly], {
      advanced: true,
      context: { today: "2026-08-10" },
    });

    expect(result.totals.volume).toBe(640);
    expect(result.totals.sets).toBe(1);
    expect(
      result.advanced.exerciseProgression.items[0].current.oneRM,
    ).toBeCloseTo(101.3, 1);
  });

  test("analiza peso corporal por repeticiones y conserva las series en cero", () => {
    const trainings = [6, 7, 8, 9, 10, 11].map((reps, index) => {
      const item = training({
        id: `bodyweight-${index}`,
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        weight: 0,
        reps,
        volume: 0,
      });
      item.exercises[0].exerciseName = "Dominadas";
      item.exercises[0].exerciseId = "pull-ups";
      item.exercises[0].loadType = "bodyweight";
      return item;
    });

    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-08-06" },
    });
    const pullUps = result.advanced.exerciseProgression.items[0];

    expect(result.totals.sets).toBe(6);
    expect(pullUps).toMatchObject({
      metricType: "repetitions",
      comparableSessionCount: 6,
      status: "progressing",
      current: { reps: 11, oneRM: 0 },
    });
    expect(pullUps.changePercent).toBeGreaterThan(40);
  });

  test("no mezcla distintos niveles de asistencia en la progresion", () => {
    const trainings = [30, 30, 30, 30, 20].map((assistance, index) => {
      const item = training({
        id: `assisted-${index}`,
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        weight: assistance,
        reps: 8,
      });
      item.exercises[0].exerciseName = "Dominada asistida";
      item.exercises[0].exerciseId = "assisted-pull-up";
      item.exercises[0].loadType = "assisted";
      return item;
    });

    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-08-05" },
    });
    const assisted = result.advanced.exerciseProgression.items[0];

    expect(assisted).toMatchObject({
      metricType: "assistedRepetitions",
      comparableSessionCount: 1,
      status: "limited",
      current: { assistanceKg: 20, reps: 8 },
      confidence: "baja",
    });
    expect(assisted.suggestion).toMatch(/cuatro sesiones comparables/i);
  });

  test("reduce la confianza de una progresion antigua", () => {
    const trainings = Array.from({ length: 8 }, (_, index) =>
      training({
        id: `old-${index}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      }),
    );
    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-09-01" },
    });
    const press = result.advanced.exerciseProgression.items[0];

    expect(press.isStale).toBe(true);
    expect(press.daysSinceLast).toBeGreaterThan(28);
    expect(press.confidence).toBe("baja");
  });

  test("no recomienda reducir la sesion solo por faltar el check-in", () => {
    const result = buildTrainingIntelligence(
      [
        training({ id: "c1", date: "2026-07-30", volume: 1000 }),
        training({ id: "c2", date: "2026-08-06", volume: 1000 }),
        training({ id: "c3", date: "2026-08-13", volume: 1000 }),
        training({ id: "c4", date: "2026-08-20", volume: 1000 }),
        training({
          id: "recent",
          date: "2026-08-25",
          weight: 30,
          volume: 500,
        }),
      ],
      {
        advanced: true,
        context: { today: "2026-08-31", checkIns: [] },
      },
    );

    expect(result.advanced.decisionSupport).toMatchObject({
      score: 80,
      state: "optimal",
      confidence: "baja",
    });
    expect(result.advanced.decisionSupport.recommendation).toMatch(/mant[eé]n/i);
    expect(
      result.advanced.decisionSupport.factors.find(
        (factor) => factor.code === "load_drop",
      ),
    ).toMatchObject({ tone: "neutral", label: "Menor actividad reciente" });
  });

  test("conserva el total real de sesiones aunque limite el historial enviado", () => {
    const trainings = Array.from({ length: 14 }, (_, index) =>
      training({
        id: `session-${index + 1}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      }),
    );
    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-07-14" },
    });
    const press = result.advanced.exerciseProgression.items[0];

    expect(press.sessionCount).toBe(14);
    expect(press.history).toHaveLength(12);
    expect(press.status).toBe("plateau");
  });

  test("compara la semana activa contra los mismos dias de la semana anterior", () => {
    const result = buildTrainingIntelligence(
      [
        training({
          id: "previous-monday",
          date: "2026-08-10",
          weight: 80,
          reps: 5,
        }),
        training({
          id: "previous-tuesday",
          date: "2026-08-11",
          weight: 82,
          reps: 5,
        }),
        training({
          id: "current-monday",
          date: "2026-08-17",
          weight: 88,
          reps: 5,
        }),
      ],
      {
        advanced: true,
        context: {
          today: "2026-08-17",
          activePlan: {
            frequencyTarget: 3,
            scheduleMode: "fixed",
            weeklySchedule: [
              { dayIndex: 1, type: "training" },
              { dayIndex: 3, type: "training" },
              { dayIndex: 5, type: "training" },
            ],
          },
          checkIns: [
            { dateKey: "2026-08-10", readinessScore: 70 },
            { dateKey: "2026-08-17", readinessScore: 84 },
          ],
        },
      },
    );

    expect(result.advanced.periodComparison.period).toMatchObject({
      current: { from: "2026-08-17", to: "2026-08-17" },
      previous: { from: "2026-08-10", to: "2026-08-10" },
      elapsedDays: 1,
      comparisonMode: "equivalent_weekdays",
    });
    expect(result.advanced.periodComparison.metrics.sessions).toMatchObject({
      current: 1,
      previous: 1,
      changePercent: 0,
    });
    expect(result.advanced.periodComparison.metrics.workload).toMatchObject({
      changePercent: 10,
      basis: { metric: "external_volume", unit: "kg" },
    });
    expect(result.advanced.periodComparison.metrics.volume).toEqual(
      result.advanced.periodComparison.metrics.workload,
    );
    expect(result.advanced.periodComparison.metrics.strength).toMatchObject({
      available: true,
      changePercent: 10.1,
      comparableExercises: 1,
      displayMode: "kg",
    });
    expect(result.advanced.periodComparison.metrics.adherence).toMatchObject({
      available: true,
      current: 100,
      previous: 100,
      target: 1,
    });
    expect(result.advanced.periodComparison.metrics.recovery).toMatchObject({
      available: true,
      current: 84,
      previous: 70,
      changePercent: 20,
    });
  });

  test("compara peso corporal por repeticiones sin inventar kilos", () => {
    const trainings = [
      training({
        id: "previous-bodyweight",
        date: "2026-08-10",
        weight: 0,
        reps: 8,
        volume: 0,
      }),
      training({
        id: "current-bodyweight",
        date: "2026-08-17",
        weight: 0,
        reps: 10,
        volume: 0,
      }),
    ].map((item) => ({
      ...item,
      exercises: item.exercises.map((exercise) => ({
        ...exercise,
        exerciseId: "pull-ups",
        exerciseName: "Dominadas",
        loadType: "bodyweight",
      })),
    }));

    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-08-17" },
    });
    const { workload, strength } = result.advanced.periodComparison.metrics;

    expect(workload).toMatchObject({
      current: 1,
      previous: 1,
      changePercent: 0,
      basis: { metric: "completed_sets", unit: "series" },
    });
    expect(strength).toMatchObject({
      available: true,
      current: 125,
      previous: 100,
      changePercent: 25,
      comparableExercises: 1,
      displayMode: "index",
      metricTypes: ["repetitions"],
    });
  });

  test("no compara rendimiento asistido con niveles de asistencia distintos", () => {
    const trainings = [
      training({
        id: "previous-assisted",
        date: "2026-08-10",
        weight: 30,
        reps: 8,
      }),
      training({
        id: "current-assisted",
        date: "2026-08-17",
        weight: 20,
        reps: 8,
      }),
    ].map((item) => ({
      ...item,
      exercises: item.exercises.map((exercise) => ({
        ...exercise,
        exerciseId: "assisted-pull-up",
        exerciseName: "Dominada asistida",
        loadType: "assisted",
      })),
    }));

    const result = buildTrainingIntelligence(trainings, {
      advanced: true,
      context: { today: "2026-08-17" },
    });

    expect(result.advanced.periodComparison.metrics.workload.basis).toMatchObject(
      { metric: "completed_sets", unit: "series" },
    );
    expect(result.advanced.periodComparison.metrics.strength).toMatchObject({
      available: false,
      comparableExercises: 0,
      displayMode: "index",
    });
  });

  test("no atribuye adherencia anterior a un plan que acaba de comenzar", () => {
    const result = buildTrainingIntelligence(
      [training({ id: "current", date: "2026-08-17" })],
      {
        advanced: true,
        context: {
          today: "2026-08-17",
          activePlan: {
            startDate: "2026-08-17T00:00:00.000Z",
            endDate: "2026-10-11T00:00:00.000Z",
            frequencyTarget: 3,
            scheduleMode: "fixed",
            weeklySchedule: [{ dayIndex: 1, type: "training" }],
          },
        },
      },
    );

    expect(result.advanced.periodComparison.metrics.adherence).toMatchObject({
      available: true,
      hasReference: false,
      current: 100,
      target: 1,
      previousTarget: null,
    });
  });

  test("mantiene las decisiones avanzadas cerradas para Free", () => {
    const result = buildTrainingIntelligence(
      [training({ id: "t1", date: "2026-08-10" })],
      { advanced: false },
    );

    expect(result.advanced).toEqual({
      available: false,
      requiresPremium: true,
      decisionSupport: null,
      exerciseProgression: null,
      periodComparison: null,
    });
  });
});
