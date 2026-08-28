import {
  calculateTimingSummary,
  normalizeTimeEvents,
} from "../src/utils/trainingTiming.js";

const at = (seconds) =>
  new Date(Date.parse("2026-08-28T10:00:00.000Z") + seconds * 1000).toISOString();

describe("training timing", () => {
  test("preserva los datos nuevos de cada evento", () => {
    expect(
      normalizeTimeEvents([
        {
          type: "set_complete",
          at: at(40),
          exerciseId: "press",
          setId: "set-1",
          source: "estimated",
          workSeconds: 40,
        },
      ])[0],
    ).toMatchObject({
      setId: "set-1",
      source: "estimated",
      workSeconds: 40,
    });
  });

  test("no convierte la preparación en tiempo de trabajo", () => {
    const summary = calculateTimingSummary([
      { type: "session_start", at: at(0) },
      { type: "exercise_selected", exerciseId: "press", at: at(0) },
      {
        type: "set_complete",
        exerciseId: "press",
        setId: "set-1",
        source: "estimated",
        workSeconds: 40,
        at: at(300),
      },
      {
        type: "rest_start",
        exerciseId: "press",
        setId: "set-1",
        restType: "between_sets",
        at: at(300),
      },
      { type: "rest_end", exerciseId: "press", at: at(420) },
      { type: "session_end", at: at(420) },
    ]);

    expect(summary).toMatchObject({
      durationSeconds: 420,
      workSeconds: 40,
      restSeconds: 120,
      preparationSeconds: 260,
    });
    expect(summary.exerciseDurations[0]).toMatchObject({
      exerciseId: "press",
      workSeconds: 40,
      restSeconds: 120,
      preparationSeconds: 260,
    });
  });
});
