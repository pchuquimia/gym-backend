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
      /recuperacion/i,
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
    expect(result.advanced.periodComparison.metrics.volume.changePercent).toBe(
      10,
    );
    expect(result.advanced.periodComparison.metrics.strength).toMatchObject({
      available: true,
      changePercent: 10,
      comparableExercises: 1,
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
