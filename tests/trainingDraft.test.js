import TrainingDraft from "../src/models/TrainingDraft.js";
import {
  MAX_DRAFT_EXERCISES,
  MAX_DRAFT_ENTRIES_PER_SET,
  validateTrainingDraftSnapshot,
} from "../src/utils/trainingDraft.js";

const buildSnapshot = (overrides = {}) => ({
  ownerId: "athlete-1",
  selectedRoutineId: "routine-1",
  trainingRequestId: "training-1",
  sessionDate: "2026-09-14",
  lastUpdate: Date.now(),
  exercises: [],
  ...overrides,
});

describe("borradores de entrenamiento", () => {
  test("acepta un snapshot valido", () => {
    expect(validateTrainingDraftSnapshot(buildSnapshot()).ok).toBe(true);
  });

  test("exige rutina e identificador de sesion", () => {
    expect(
      validateTrainingDraftSnapshot(buildSnapshot({ selectedRoutineId: "" }))
        .ok,
    ).toBe(false);
    expect(
      validateTrainingDraftSnapshot(buildSnapshot({ trainingRequestId: "" }))
        .ok,
    ).toBe(false);
  });

  test("limita la estructura del borrador", () => {
    expect(
      validateTrainingDraftSnapshot(
        buildSnapshot({
          exercises: Array.from(
            { length: MAX_DRAFT_EXERCISES + 1 },
            () => ({}),
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateTrainingDraftSnapshot(
        buildSnapshot({
          exercises: [
            {
              sets: [
                {
                  entries: Array.from(
                    { length: MAX_DRAFT_ENTRIES_PER_SET + 1 },
                    () => ({}),
                  ),
                },
              ],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  test("el modelo mantiene un borrador por alumno y autor", () => {
    const draft = new TrainingDraft({
      ownerId: "athlete-1",
      startedById: "coach-1",
      trainingRequestId: "training-1",
      routineId: "routine-1",
      snapshot: buildSnapshot(),
    });
    expect(draft.validateSync()).toBeUndefined();
    expect(draft.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
