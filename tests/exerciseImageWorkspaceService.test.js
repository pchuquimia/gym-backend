import {
  buildExerciseImageWorkspaceItems,
  combineImageInstructions,
} from "../src/services/exerciseImageWorkspaceService.js";

describe("exerciseImageWorkspaceService", () => {
  it("combina la instrucción maestra con el ajuste específico", () => {
    const instruction = combineImageInstructions(
      "Fondo uniforme",
      "Conservar el agarre",
    );
    expect(instruction).toContain("INSTRUCCION MAESTRA:\nFondo uniforme");
    expect(instruction).toContain("AJUSTE ESPECIFICO:\nConservar el agarre");
  });

  it("prioriza ejercicios del plan activo y conserva su contexto", () => {
    const items = buildExerciseImageWorkspaceItems({
      routines: [
        {
          _id: "routine-1",
          name: "Upper",
          exercises: [
            {
              exerciseId: "press",
              alternatives: [{ exerciseId: "fly" }],
            },
          ],
        },
      ],
      plans: [
        {
          _id: "plan-1",
          name: "Mes 1",
          status: "active",
          weeklySchedule: [{ routineId: "routine-1" }],
        },
      ],
      exercises: [
        { _id: "fly", name: "Aperturas", image: "https://img/fly.webp" },
        {
          _id: "press",
          name: "Press de banca",
          image: "https://img/press.webp",
          primaryMuscleGroup: "Pecho",
        },
      ],
      requests: [
        {
          _id: "request-1",
          exerciseId: "press",
          status: "pending",
          createdAt: new Date(),
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "fly",
      inActivePlan: true,
      routineCount: 1,
      planCount: 1,
      usedAsAlternative: true,
    });
    const press = items.find((item) => item.id === "press");
    expect(press.planNames).toEqual(["Mes 1"]);
    expect(press.latestRequest.active).toBe(true);
  });
});
