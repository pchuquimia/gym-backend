import { classifyTrainingPlanLifecycleCandidates } from "../src/utils/trainingPlanLifecycle.js";

describe("training plan lifecycle", () => {
  test("clasifica planes vencidos y prioriza la programacion mas reciente", () => {
    const today = new Date("2026-09-15T00:00:00.000Z");
    const result = classifyTrainingPlanLifecycleCandidates(
      [
        {
          _id: "expired",
          status: "active",
          endDate: "2026-09-14T00:00:00.000Z",
        },
        {
          _id: "future",
          status: "scheduled",
          startDate: "2026-09-20T00:00:00.000Z",
          endDate: "2026-10-20T00:00:00.000Z",
        },
        {
          _id: "due-old",
          status: "scheduled",
          startDate: "2026-09-10T00:00:00.000Z",
          endDate: "2026-10-10T00:00:00.000Z",
          updatedAt: "2026-09-10T10:00:00.000Z",
        },
        {
          _id: "due-new",
          status: "scheduled",
          startDate: "2026-09-12T00:00:00.000Z",
          endDate: "2026-10-12T00:00:00.000Z",
          updatedAt: "2026-09-14T10:00:00.000Z",
        },
      ],
      today,
    );

    expect(result.expired.map((plan) => plan._id)).toEqual(["expired"]);
    expect(result.duePlans.map((plan) => plan._id)).toEqual([
      "due-new",
      "due-old",
    ]);
  });
});
