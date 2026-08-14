import { normalizeHistoricalExerciseConfig } from "../src/utils/historicalExerciseConfig.js";

describe("historical exercise config", () => {
  test("normaliza una corrección unilateral de máquina", () => {
    expect(
      normalizeHistoricalExerciseConfig({
        movementMode: "unilateral",
        weightBasis: "machine",
      }),
    ).toEqual({
      movementMode: "unilateral",
      weightBasis: "machine",
      barWeightKg: 0,
      implementCount: 1,
    });
  });

  test("conserva los valores específicos de barra e implementos", () => {
    expect(
      normalizeHistoricalExerciseConfig({
        movementMode: "bilateral",
        weightBasis: "per_side",
        barWeightKg: 20,
        implementCount: 2,
      }),
    ).toMatchObject({ barWeightKg: 20, implementCount: 1 });
  });

  test("rechaza modalidades desconocidas", () => {
    expect(() =>
      normalizeHistoricalExerciseConfig({ movementMode: "alternado" }),
    ).toThrow("bilateral o unilateral");
  });
});
