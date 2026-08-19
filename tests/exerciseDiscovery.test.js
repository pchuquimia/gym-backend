import {
  buildExerciseDiscoveryScoreExpression,
  getExerciseDiscovery,
} from "../src/utils/exerciseDiscovery.js";

describe("exercise discovery", () => {
  test("identifica una familia básica y penaliza una variante avanzada", () => {
    const basic = getExerciseDiscovery({ name: "Press de banca" });
    const advanced = getExerciseDiscovery({
      name: "Smith press de banca con agarre cerrado",
    });

    expect(basic.familyId).toBe("bench-press");
    expect(basic.familyName).toBe("Press de pecho");
    expect(basic.isEssential).toBe(true);
    expect(advanced.isEssential).toBe(false);
    expect(basic.score).toBeGreaterThan(advanced.score);
  });

  test("prioriza una coincidencia exacta incluyendo alias", () => {
    const result = getExerciseDiscovery(
      {
        name: "Barbell Bench Press",
        aliases: ["Press banca"],
      },
      "press banca",
    );

    expect(result.score).toBeGreaterThanOrEqual(1000);
  });

  test("genera una expresión de ranking válida para la agregación", () => {
    const expression = buildExerciseDiscoveryScoreExpression({
      exactSearchPattern: "^press$",
      prefixSearchPattern: "^press",
    });

    expect(expression.$add).toHaveLength(7);
    expect(expression.$add[1].$cond[1]).toBe(1000);
    expect(expression.$add[2].$cond[1]).toBe(500);
  });
});
