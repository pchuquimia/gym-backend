import {
  buildAssistedPlanDraft,
  buildWeeklyReport,
  calculateReadiness,
} from "../src/utils/coachPremium.js";

describe("coachPremium", () => {
  test("clasifica un check-in favorable como listo", () => {
    expect(
      calculateReadiness({
        sleep: 5,
        energy: 4,
        stress: 1,
        soreness: 2,
        motivation: 5,
        jointPain: 1,
      }),
    ).toMatchObject({ state: "ready" });
  });

  test("prioriza recuperacion cuando energia y dolor son desfavorables", () => {
    const result = calculateReadiness({
      sleep: 2,
      energy: 1,
      stress: 5,
      soreness: 5,
      motivation: 2,
      jointPain: 5,
    });
    expect(result.state).toBe("recover");
    expect(result.score).toBeLessThan(48);
  });

  test("calcula adherencia, comparacion y alertas semanales", () => {
    const report = buildWeeklyReport({
      athlete: { _id: "a1", name: "Ana" },
      today: new Date("2026-08-15T12:00:00.000Z"),
      activePlan: { frequencyTarget: 4, endDate: "2026-09-01" },
      trainings: [
        {
          date: "2026-08-12",
          totalVolume: 1000,
          durationSeconds: 3600,
          volumeBreakdown: { completedSets: 10, externalKg: 1000 },
        },
        {
          date: "2026-08-08",
          totalVolume: 800,
          durationSeconds: 3000,
          volumeBreakdown: { completedSets: 8, externalKg: 800 },
        },
      ],
    });
    expect(report.adherence).toEqual({
      completed: 1,
      target: 4,
      percentage: 25,
      available: true,
    });
    expect(report.comparison.volumePercent).toBe(25);
    expect(report.workload).toMatchObject({
      basis: { metric: "external_volume", unit: "kg" },
      current: 1000,
      previous: 800,
      changePercent: 25,
    });
    expect(report.alerts.some((alert) => alert.code === "low_adherence")).toBe(
      true,
    );
    expect(report.priority).toBe("high");
  });

  test("usa series en informes mixtos y no suma asistencia como carga", () => {
    const assisted = (date, assistanceKg) => ({
      date,
      durationSeconds: 2400,
      exercises: [
        {
          exerciseId: "assisted-pull-up",
          exerciseName: "Dominada asistida",
          loadType: "assisted",
          sets: [{ weightKg: assistanceKg, reps: 8, done: true }],
        },
      ],
    });
    const report = buildWeeklyReport({
      athlete: { _id: "a1", name: "Ana" },
      today: new Date("2026-08-15T12:00:00.000Z"),
      trainings: [assisted("2026-08-12", 20), assisted("2026-08-08", 40)],
    });

    expect(report.workload).toMatchObject({
      basis: { metric: "completed_sets", unit: "series" },
      current: 1,
      previous: 1,
      changePercent: 0,
    });
    expect(report.comparison.volumePercent).toBeNull();
    expect(report.recommendation).not.toMatch(/subi[oó] con rapidez/i);
  });

  test("cuenta solo sesiones programadas desde el inicio del plan", () => {
    const report = buildWeeklyReport({
      athlete: { _id: "a1", name: "Ana" },
      today: new Date("2026-08-15T12:00:00.000Z"),
      activePlan: {
        startDate: "2026-08-13",
        endDate: "2026-09-30",
        scheduleMode: "fixed",
        weeklySchedule: [
          { dayIndex: 1, type: "training" },
          { dayIndex: 3, type: "training" },
          { dayIndex: 5, type: "training" },
        ],
      },
      trainings: [{ date: "2026-08-14", volumeBreakdown: { completedSets: 5 } }],
    });

    expect(report.adherence).toEqual({
      completed: 1,
      target: 1,
      percentage: 100,
      available: true,
    });
  });

  test("no calcula baja adherencia antes de la primera sesion programada", () => {
    const report = buildWeeklyReport({
      athlete: { _id: "a1", name: "Ana" },
      today: new Date("2026-08-13T12:00:00.000Z"),
      activePlan: {
        startDate: "2026-08-13",
        endDate: "2026-09-30",
        scheduleMode: "fixed",
        weeklySchedule: [{ dayIndex: 5, type: "training" }],
      },
      trainings: [{ date: "2026-08-12", volumeBreakdown: { completedSets: 5 } }],
    });

    expect(report.adherence).toEqual({
      completed: 0,
      target: 0,
      percentage: null,
      available: false,
    });
    expect(report.alerts.some((alert) => alert.code === "low_adherence")).toBe(
      false,
    );
  });

  test("genera un borrador editable usando rutinas existentes", () => {
    const result = buildAssistedPlanDraft({
      athlete: { name: "Luis", profile: { goal: "volumen" } },
      frequency: 3,
      today: new Date("2026-08-15T12:00:00.000Z"),
      trainings: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      })),
      routines: [
        { _id: "r1", name: "Empuje" },
        { _id: "r2", name: "Tiron" },
        { _id: "r3", name: "Piernas" },
      ],
    });
    expect(result.source).toBe("rules_v1");
    expect(result.plan.level).toBe("intermediate");
    expect(result.plan.goal).toBe("Hipertrofia");
    expect(
      result.plan.weeklySchedule.filter((day) => day.type === "training"),
    ).toHaveLength(3);
    expect(
      result.plan.weeklySchedule.filter((day) => day.sourceRoutineId),
    ).toHaveLength(3);
  });
});
