import {
  applySessionValueEdits,
  applyTrainingValueEdits,
  normalizeHistoricalValueEdits,
} from "../src/utils/historicalValueEdits.js";

describe("historical value edits", () => {
  test("normaliza peso, repeticiones e índices", () => {
    expect(
      normalizeHistoricalValueEdits([
        { setIndex: 0, entryIndex: 0, weightKg: "42.5", reps: "10" },
      ]),
    ).toEqual([{ setIndex: 0, entryIndex: 0, weightKg: 42.5, reps: 10 }]);
  });

  test("actualiza una entrada de entrenamiento sin reemplazar su estructura", () => {
    const exercise = {
      sets: [{ entries: [{ weightKg: 40, reps: 8, done: true }] }],
    };
    applyTrainingValueEdits(exercise, [
      { setIndex: 0, entryIndex: 0, weightKg: 35, reps: 10 },
    ]);
    expect(exercise.sets[0].entries[0]).toEqual({
      weightKg: 35,
      reps: 10,
      done: true,
    });
  });

  test("actualiza una serie heredada", () => {
    const session = { sets: [{ weight: 100, reps: 5, note: "control" }] };
    applySessionValueEdits(session, [
      { setIndex: 0, entryIndex: 0, weightKg: 90, reps: 6 },
    ]);
    expect(session.sets[0]).toEqual({ weight: 90, reps: 6, note: "control" });
  });

  test("rechaza pesos fuera de rango y series duplicadas", () => {
    expect(() =>
      normalizeHistoricalValueEdits([
        { setIndex: 0, entryIndex: 0, weightKg: 9000, reps: 1 },
      ]),
    ).toThrow("peso");
    expect(() =>
      normalizeHistoricalValueEdits([
        { setIndex: 0, entryIndex: 0, weightKg: 10, reps: 1 },
        { setIndex: 0, entryIndex: 0, weightKg: 20, reps: 2 },
      ]),
    ).toThrow("misma serie");
  });
});
