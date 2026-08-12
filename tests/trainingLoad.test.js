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

  test("calcula tonelaje con peso por lado y peso de barra", () => {
    const metrics = getTrainingLoadMetrics([
      {
        name: "Press con barra",
        equipment: ["Barra"],
        weightBasis: "per_side",
        barWeightKg: 20,
        sets: [{ entries: [{ done: true, kg: 10, reps: 10 }] }],
      },
    ]);

    expect(metrics.externalKg).toBe(400);
  });

  test("calcula tonelaje por cantidad de mancuernas", () => {
    const metrics = getTrainingLoadMetrics([
      {
        name: "Press con mancuernas",
        equipment: ["Mancuernas"],
        weightBasis: "per_implement",
        implementCount: 2,
        sets: [{ entries: [{ done: true, kg: 12, reps: 10 }] }],
      },
    ]);

    expect(metrics.externalKg).toBe(240);
  });

  test("suma el lastre corporal como carga externa", () => {
    const metrics = getTrainingLoadMetrics([
      {
        name: "Dominada lastrada",
        equipment: ["Peso corporal"],
        loadType: "bodyweight",
        weightBasis: "additional",
        sets: [{ entries: [{ done: true, kg: 10, reps: 8 }] }],
      },
    ]);

    expect(metrics.externalKg).toBe(80);
    expect(metrics.bodyweightSets).toBe(1);
  });
});
