import { scoreExerciseSearch } from "../src/utils/exerciseSearch.js";

const bench = {
  name: "Dumbbell Incline Bench Press",
  localizedNames: { es: "Press de banca inclinado con mancuernas" },
  primaryMuscleGroup: "Pecho",
  equipment: ["Mancuernas"],
};

describe("búsqueda de ejercicios", () => {
  test("encuentra palabras incompletas en otro orden y sin acentos", () => {
    expect(scoreExerciseSearch(bench, "mancu press incli")).toBeGreaterThan(0);
    expect(scoreExerciseSearch(bench, "press mancuernas inclinadó")).toBeGreaterThan(0);
  });

  test("admite un error de escritura y sinónimos habituales", () => {
    expect(scoreExerciseSearch(bench, "press mancuerma")).toBeGreaterThan(0);
    expect(scoreExerciseSearch({ localizedNames: { es: "Flexión de brazos" } }, "lagartijas")).toBeGreaterThan(0);
    expect(scoreExerciseSearch({ localizedNames: { es: "Elevación de pantorrillas" } }, "gemelos")).toBeGreaterThan(0);
    expect(scoreExerciseSearch({ localizedNames: { es: "Peso muerto rumano" } }, "peso muerto romanian")).toBeGreaterThan(0);
    expect(scoreExerciseSearch({ localizedNames: { es: "Sentadilla con barra" } }, "sentadilla pesas")).toBeGreaterThan(0);
  });

  test("lagartijas no devuelve una flexión lateral", () => {
    expect(scoreExerciseSearch({ localizedNames: { es: "Flexión lateral" } }, "lagartijas")).toBe(0);
  });

  test("exige todos los datos y prioriza el nombre exacto", () => {
    expect(scoreExerciseSearch(bench, "press sentadilla")).toBe(0);
    expect(scoreExerciseSearch(bench, "Press de banca inclinado con mancuernas"))
      .toBeGreaterThan(scoreExerciseSearch(bench, "press mancuernas"));
  });

  test("permite varias alternativas separadas por barra vertical", () => {
    expect(scoreExerciseSearch(bench, "sentadilla|press banca")).toBeGreaterThan(0);
    expect(scoreExerciseSearch({ name: "Dumbbell Romanian Deadlift" }, "peso muerto rumano mancuerna")).toBeGreaterThan(0);
  });
});
