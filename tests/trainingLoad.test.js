import {
  classifyExerciseLoad,
  getTrainingLoadMetrics,
  isCompletedSet,
} from "../src/utils/trainingLoad.js";

describe("trainingLoad", () => {
  test.each([
    [{ name: "Press con barra", equipment: ["Barra"] }, "external"],
    [{ name: "Jalon en polea", equipment: ["Polea"] }, "machine"],
    [{ name: "Dominada asistida" }, "assisted"],
    [{ name: "Flexiones", equipment: ["Peso corporal"] }, "bodyweight"],
    [{ name: "Bicicleta estatica" }, "cardio"],
  ])("clasifica %o como %s", (exercise, expected) => {
    expect(classifyExerciseLoad(exercise)).toBe(expected);
  });

  test("una serie unilateral solo termina con todas sus entradas", () => {
    expect(isCompletedSet({ entries: [{ done: true }, { done: false }] })).toBe(
      false,
    );
    expect(isCompletedSet({ entries: [{ done: true }, { done: true }] })).toBe(
      true,
    );
  });

  test("separa tonelaje libre, maquina y series incompletas", () => {
    const metrics = getTrainingLoadMetrics([
      {
        name: "Press con barra",
        equipment: ["Barra"],
        sets: [{ entries: [{ done: true, kg: 50, reps: 10 }] }],
      },
      {
        name: "Prensa en maquina",
        equipment: ["Maquina"],
        sets: [
          { entries: [{ done: true, kg: 100, reps: 8 }] },
          { entries: [{ done: false, kg: 100, reps: 8 }] },
        ],
      },
    ]);

    expect(metrics.externalKg).toBe(500);
    expect(metrics.machineKg).toBe(800);
    expect(metrics.completedSets).toBe(2);
    expect(metrics.incompleteSets).toBe(1);
    expect(metrics.recordedKg).toBe(1300);
  });
});
