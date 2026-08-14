import {
  buildExerciseHistoryMatch,
  matchesExerciseHistoryTarget,
} from "../src/utils/exerciseHistory.js";

describe("exercise history", () => {
  test("busca por identificador y nombre sin permitir expresiones regulares", () => {
    const match = buildExerciseHistoryMatch({
      exerciseId: "press-machine",
      exerciseName: "Press (máquina)",
    });

    expect(match.$or[0]).toEqual({
      "exercises.exerciseId": "press-machine",
    });
    expect(match.$or[1]["exercises.exerciseName"]).toEqual(
      /^Press \(máquina\)$/i,
    );
  });

  test("reconoce registros heredados por nombre normalizado", () => {
    expect(
      matchesExerciseHistoryTarget(
        { exerciseName: "Extensión de cuádriceps" },
        { exerciseId: "new-id", exerciseName: "extension de cuadriceps" },
      ),
    ).toBe(true);
  });
});
