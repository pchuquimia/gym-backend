import { convertHistoricalWeight } from "../src/utils/exerciseWeightMigration.js";

describe("exercise weight migration", () => {
  test("convierte un total al peso por lado descontando la barra", () => {
    expect(
      convertHistoricalWeight(100, {
        conversion: "from_total",
        targetConfig: { weightBasis: "per_side", barWeightKg: 20 },
      }),
    ).toBe(40);
  });

  test("convierte un total de prensa al peso de discos por lado", () => {
    expect(
      convertHistoricalWeight(240, {
        conversion: "from_total",
        targetConfig: { weightBasis: "per_side", barWeightKg: 0 },
      }),
    ).toBe(120);
  });

  test("recupera el total efectivo de un registro por implemento", () => {
    expect(
      convertHistoricalWeight(30, {
        conversion: "to_total",
        sourceConfig: {
          weightBasis: "per_implement",
          implementCount: 2,
        },
      }),
    ).toBe(60);
  });

  test("conserva ceros y campos vacíos", () => {
    expect(
      convertHistoricalWeight(0, {
        conversion: "from_total",
        targetConfig: { weightBasis: "per_side", barWeightKg: 20 },
      }),
    ).toBe(0);
    expect(convertHistoricalWeight(null)).toBeNull();
  });
});
