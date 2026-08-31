import {
  migrateRoutineExerciseList,
  migrateTrainingDocument,
} from "../src/services/exerciseMigrationService.js";

const target = {
  _id: "exercise-main",
  localizedNames: { es: "Press de banca" },
  primaryMuscleGroup: "Pecho",
  supportsUnilateral: false,
  movementMode: "bilateral",
  image: "main.webp",
};

describe("Exercise merge transformations", () => {
  test("une un duplicado de rutina con el ejercicio que se conserva", () => {
    const exercises = migrateRoutineExerciseList(
      [
        {
          exerciseId: "exercise-main",
          name: "Press principal",
          sets: 3,
          alternatives: [{ exerciseId: "alternative", name: "Alternativa" }],
        },
        {
          exerciseId: "exercise-copy",
          name: "Press repetido",
          sets: 4,
          alternatives: [
            { exerciseId: "exercise-main", name: "Principal" },
            { exerciseId: "alternative", name: "Alternativa repetida" },
          ],
        },
      ],
      "exercise-copy",
      target,
    );

    expect(exercises).toHaveLength(1);
    expect(exercises[0]).toMatchObject({
      exerciseId: "exercise-main",
      name: "Press de banca",
      sets: 4,
      muscle: "Pecho",
    });
    expect(exercises[0].alternatives).toEqual([
      { exerciseId: "alternative", name: "Alternativa" },
    ]);
  });

  test("une series y tiempos cuando ambos ejercicios están en el mismo entrenamiento", () => {
    const result = migrateTrainingDocument(
      {
        exercises: [
          {
            exerciseId: "exercise-main",
            exerciseName: "Press principal",
            order: 2,
            sets: [{ reps: 10, weight: 40 }],
          },
          {
            exerciseId: "exercise-copy",
            exerciseName: "Press repetido",
            order: 1,
            sets: [{ reps: 8, weight: 45 }],
          },
        ],
        timeEvents: [{ exerciseId: "exercise-copy", type: "set_complete" }],
        exerciseDurations: [
          { exerciseId: "exercise-main", durationSeconds: 80 },
          { exerciseId: "exercise-copy", durationSeconds: 100 },
        ],
      },
      "exercise-copy",
      target,
    );

    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0]).toMatchObject({
      exerciseId: "exercise-main",
      exerciseName: "Press de banca",
      order: 1,
    });
    expect(result.exercises[0].sets).toEqual([
      { reps: 10, weight: 40, order: 1 },
      { reps: 8, weight: 45, order: 2 },
    ]);
    expect(result.timeEvents[0].exerciseId).toBe("exercise-main");
    expect(result.exerciseDurations).toEqual([
      {
        exerciseId: "exercise-main",
        durationSeconds: 180,
        durationOverrideSeconds: null,
      },
    ]);
    expect(result.orderSignature).toBe("exercise-main");
  });
});
