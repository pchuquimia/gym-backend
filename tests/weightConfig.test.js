import {
  getEffectiveWeightKg,
  inferWeightConfig,
  toTrainingWeightConfig,
} from "../src/utils/weightConfig.js";

describe("weightConfig", () => {
  test("prioriza la configuración persistida del catálogo", () => {
    expect(
      inferWeightConfig({
        equipment: ["Mancuernas"],
        weightConfig: { basis: "per_implement", implementCount: 1 },
      }),
    ).toEqual({
      basis: "per_implement",
      barWeightKg: 0,
      implementCount: 1,
    });
  });

  test("genera el snapshot plano usado por el entrenamiento", () => {
    expect(
      toTrainingWeightConfig({
        weightConfig: { basis: "per_side", barWeightKg: 15 },
      }),
    ).toEqual({
      weightBasis: "per_side",
      barWeightKg: 15,
      implementCount: 1,
    });
  });

  test("mantiene asistencia y carga adicional como valores directos", () => {
    expect(getEffectiveWeightKg(30, { weightBasis: "assistance" })).toBe(30);
    expect(getEffectiveWeightKg(10, { weightBasis: "additional" })).toBe(10);
  });
});
