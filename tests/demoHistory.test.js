import {
  buildDemoTrainingOffsets,
  buildDemoWeightOffsets,
  demoProgressionKg,
  getDemoHistoryTrainingCount,
} from "../src/utils/demoHistory.js";

describe("demo history generator", () => {
  const previousCount = process.env.DEMO_HISTORY_TRAININGS;

  afterEach(() => {
    if (previousCount === undefined) delete process.env.DEMO_HISTORY_TRAININGS;
    else process.env.DEMO_HISTORY_TRAININGS = previousCount;
  });

  test("genera 200 entrenamientos ordenados en dias programados", () => {
    const today = new Date("2026-08-11T12:00:00.000Z");
    const offsets = buildDemoTrainingOffsets(200, today);

    expect(offsets).toHaveLength(200);
    expect(offsets[0]).toBeLessThan(offsets.at(-1));
    expect(new Set(offsets).size).toBe(200);
    offsets.forEach((offset) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + offset);
      expect([1, 2, 4, 6]).toContain(date.getUTCDay());
    });
  });

  test("genera pesajes unicos e incluye el dia actual", () => {
    const offsets = buildDemoWeightOffsets(120);
    expect(offsets).toHaveLength(120);
    expect(new Set(offsets).size).toBe(120);
    expect(offsets.at(-1)).toBe(0);
  });

  test("mantiene la progresion dentro de un rango humano", () => {
    const values = Array.from({ length: 200 }, (_, index) =>
      demoProgressionKg(index, 200),
    );
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(21);
    expect(values.at(-1)).toBeGreaterThan(values[0]);
  });

  test("permite configurar el historial dentro de limites seguros", () => {
    process.env.DEMO_HISTORY_TRAININGS = "160";
    expect(getDemoHistoryTrainingCount()).toBe(160);
    process.env.DEMO_HISTORY_TRAININGS = "1000";
    expect(getDemoHistoryTrainingCount()).toBe(200);
  });
});
