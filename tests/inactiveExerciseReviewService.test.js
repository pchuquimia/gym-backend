import { jest } from "@jest/globals";
import Exercise from "../src/models/Exercise.js";
import Routine from "../src/models/Routine.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import {
  inactiveExerciseReason,
  permanentlyDeleteInactiveExercise,
  restoreInactiveExercise,
} from "../src/services/inactiveExerciseReviewService.js";

afterEach(() => jest.restoreAllMocks());

describe("clasificación de ejercicios desactivados", () => {
  test("distingue el catálogo anterior de las fichas en revisión", () => {
    expect(inactiveExerciseReason({})).toBe("previous_catalog");
    expect(inactiveExerciseReason({ source: { provider: "hasaneyldrm" }, classificationStatus: "review" })).toBe("review");
  });

  test("prioriza la fusión sobre cualquier otro motivo", () => {
    expect(inactiveExerciseReason({
      source: { provider: "hasaneyldrm" },
      classificationStatus: "reviewed",
      mergedIntoExerciseId: "target",
    })).toBe("merged");
  });
});

describe("decisiones sobre fichas desactivadas", () => {
  test("impide borrar una ficha que sigue en una rutina", async () => {
    jest.spyOn(Exercise, "findById").mockReturnValue({ lean: async () => ({ _id: "face-pull", type: "system", isActive: false }) });
    jest.spyOn(Routine, "countDocuments").mockResolvedValue(1);
    jest.spyOn(Training, "find").mockReturnValue({ lean: async () => [] });
    jest.spyOn(Session, "find").mockReturnValue({ lean: async () => [] });
    const deleteOne = jest.spyOn(Exercise, "deleteOne").mockResolvedValue({ deletedCount: 1 });

    await expect(permanentlyDeleteInactiveExercise({ exerciseId: "face-pull", performedBy: "admin" }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(deleteOne).not.toHaveBeenCalled();
  });

  test("impide reactivar una ficha que ya fue fusionada", async () => {
    const save = jest.fn();
    jest.spyOn(Exercise, "findById").mockResolvedValue({
      _id: "merged",
      type: "system",
      isActive: false,
      mergedIntoExerciseId: "target",
      save,
    });

    await expect(restoreInactiveExercise({ exerciseId: "merged", performedBy: "admin" }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(save).not.toHaveBeenCalled();
  });
});
