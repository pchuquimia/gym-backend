import { buildTrainingHistoryScopeFilter } from "../src/utils/trainingHistoryFilter.js";

describe("buildTrainingHistoryScopeFilter", () => {
  test("comparte el historial del ciclo o de la planificación", () => {
    expect(
      buildTrainingHistoryScopeFilter({
        progressScopeId: "scope_1",
        includeTrainingPlanId: "plan_1",
      }),
    ).toEqual({
      $or: [
        { progressScopeId: "scope_1" },
        { trainingPlanId: "plan_1" },
      ],
    });
  });

  test("permite excluir el ciclo actual al consultar referencias externas", () => {
    expect(
      buildTrainingHistoryScopeFilter({
        excludeProgressScopeId: "scope_1",
      }),
    ).toEqual({ progressScopeId: { $ne: "scope_1" } });
  });

  test("combina inclusión y exclusión sin sobrescribir el alcance", () => {
    expect(
      buildTrainingHistoryScopeFilter({
        includeTrainingPlanId: "plan_1",
        excludeProgressScopeId: "scope_1",
      }),
    ).toEqual({
      $and: [
        { trainingPlanId: "plan_1" },
        { progressScopeId: { $ne: "scope_1" } },
      ],
    });
  });
});
