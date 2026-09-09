import {
  buildTrainingRegistrationKey,
  normalizeTrainingDateKey,
  resolvePlannedTrainingSlot,
  validateTrainingSubmission,
} from "../src/utils/trainingSubmission.js";

describe("training submission", () => {
  test.each(["2026-02-31", "18/08/2026", "", null])(
    "rechaza una fecha invalida: %p",
    (value) => {
      expect(normalizeTrainingDateKey(value)).toBeNull();
    },
  );

  test("acepta una fecha calendario valida", () => {
    expect(normalizeTrainingDateKey("2026-08-18T23:00:00.000Z")).toBe(
      "2026-08-18",
    );
  });

  test("genera una clave estable para bloquear dobles envios", () => {
    expect(
      buildTrainingRegistrationKey({
        ownerId: "athlete_1",
        date: "2026-08-18",
        routineId: "routine_1",
      }),
    ).toBe("v1:athlete_1:2026-08-18:routine_1");
  });

  test("distingue por dia una rutina reutilizada en la misma semana", () => {
    const weeklySchedule = [
      {
        slotId: "lunes_lower_a",
        dayIndex: 1,
        type: "training",
        routineId: "lower_a",
      },
      {
        slotId: "miercoles_lower_a",
        dayIndex: 3,
        type: "training",
        routineId: "lower_a",
      },
    ];

    expect(
      resolvePlannedTrainingSlot({
        weeklySchedule,
        scheduleMode: "fixed",
        routineId: "lower_a",
        date: "2026-09-09",
      }),
    ).toMatchObject({ slotId: "miercoles_lower_a", dayIndex: 3 });
  });

  test("mantiene el bloque esperado cuando el plan es secuencial", () => {
    const weeklySchedule = [
      {
        slotId: "primera_lower_a",
        type: "training",
        routineId: "lower_a",
      },
      {
        slotId: "segunda_lower_a",
        type: "training",
        routineId: "lower_a",
      },
    ];

    expect(
      resolvePlannedTrainingSlot({
        weeklySchedule,
        scheduleMode: "sequential",
        cycleIndex: 1,
        routineId: "lower_a",
        date: "2026-09-09",
      }),
    ).toMatchObject({ slotId: "segunda_lower_a" });
  });

  test("rechaza un entrenamiento sin series registradas", () => {
    const result = validateTrainingSubmission({
      date: "2026-08-18",
      exercises: [{ sets: [{ entries: [{ done: false }] }] }],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      code: "EMPTY_TRAINING",
    });
  });

  test("acepta una serie registrada aunque aun este incompleta", () => {
    const result = validateTrainingSubmission({
      date: "2026-08-18",
      exercises: [
        { sets: [{ entries: [{ done: false, weightKg: 20, reps: 8 }] }] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.loadMetrics.recordedSets).toBe(1);
  });
});
