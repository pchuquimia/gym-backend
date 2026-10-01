import { naturalizeExerciseNameFully } from "../src/utils/naturalizeExerciseName.js";

describe("nombres naturales de ejercicios", () => {
  test("ordena modificadores sin cambiar equipo o movimiento", () => {
    expect(naturalizeExerciseNameFully("Acostado un brazo curl de bíceps con mancuernas", { group: "Bíceps" }))
      .toBe("Curl de bíceps acostado a un brazo con mancuernas");
  });

  test("resuelve traducciones literales frecuentes", () => {
    expect(naturalizeExerciseNameFully("Romanian peso muerto con barra", { group: "Glúteos" }))
      .toBe("Peso muerto rumano con barra");
    expect(naturalizeExerciseNameFully("Bíceps curl femoral de concentración", { group: "Bíceps" }))
      .toBe("Curl de bíceps de concentración apoyado en la pierna");
  });

  test("es estable tras una nueva importación", () => {
    const name = naturalizeExerciseNameFully("Smith agarre cerrado press de banca", { group: "Tríceps" });
    expect(naturalizeExerciseNameFully(name, { group: "Tríceps" })).toBe(name);
  });
});
