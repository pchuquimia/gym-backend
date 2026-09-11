import {
  buildTrackingMissions,
  defaultCoachWorkflow,
  normalizeFollowUp,
  normalizeIntakeQuestions,
  resolvePlanFollowUp,
} from "../src/utils/coachWorkflow.js";

describe("coach workflow", () => {
  test("normaliza preguntas configurables y elimina tipos no permitidos", () => {
    expect(
      normalizeIntakeQuestions([
        {
          key: "Lesiones actuales",
          label: "¿Tienes lesiones?",
          type: "unknown",
          required: true,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        key: "lesiones_actuales",
        type: "long_text",
        required: true,
        enabled: true,
      }),
    ]);
  });

  test("incluye un formulario inicial realista sin repetir datos del perfil", () => {
    const questions = defaultCoachWorkflow().intakeQuestions;
    const recentTraining = questions.find(
      (question) => question.key === "recent_training",
    );
    const injuries = questions.find((question) => question.key === "injuries");

    expect(questions).toHaveLength(12);
    expect(recentTraining).toEqual(
      expect.objectContaining({
        type: "yes_no",
        detailRequired: true,
      }),
    );
    expect(injuries).toEqual(
      expect.objectContaining({
        type: "yes_no",
        detailRequired: true,
        detailPrompt: expect.any(String),
      }),
    );
  });

  test("actualiza el formulario predeterminado anterior sin tocar formularios personalizados", () => {
    const legacy = [
      {
        key: "medical_conditions",
        label: "¿Tienes alguna condición médica que tu coach deba conocer?",
        type: "long_text",
        required: true,
      },
      {
        key: "medications",
        label: "¿Tomas medicamentos que puedan influir en tu entrenamiento?",
        type: "long_text",
        required: false,
      },
      {
        key: "injuries",
        label: "¿Tienes lesiones, dolor o movimientos que debamos evitar?",
        type: "long_text",
        required: true,
      },
      {
        key: "equipment",
        label: "¿Dónde entrenarás y qué equipamiento tienes disponible?",
        type: "long_text",
        required: true,
      },
      {
        key: "preferences",
        label: "¿Qué ejercicios disfrutas o prefieres evitar?",
        type: "long_text",
        required: false,
      },
    ];

    expect(normalizeIntakeQuestions(legacy)).toHaveLength(12);
    expect(
      normalizeIntakeQuestions([
        { ...legacy[0], label: "Pregunta personalizada" },
        ...legacy.slice(1),
      ]),
    ).toHaveLength(5);
  });

  test("el plan puede heredar o reemplazar el protocolo del coach", () => {
    const coach = defaultCoachWorkflow();
    coach.followUp.weight.intervalWeeks = 2;
    expect(
      resolvePlanFollowUp({ followUp: { useCoachDefaults: true } }, coach)
        .weight.intervalWeeks,
    ).toBe(2);
    expect(
      resolvePlanFollowUp(
        {
          followUp: {
            useCoachDefaults: false,
            weight: { enabled: true, intervalWeeks: 6, weekday: 1 },
          },
        },
        coach,
      ).weight.intervalWeeks,
    ).toBe(6);
  });

  test("genera misiones obligatorias y opcionales en su fecha", () => {
    const policy = normalizeFollowUp({
      checkIn: { enabled: true, cadence: "daily" },
      weight: { enabled: true, intervalWeeks: 1, weekday: 3, required: true },
      photos: {
        enabled: true,
        intervalWeeks: 1,
        required: false,
        views: ["front"],
      },
      measurements: {
        enabled: true,
        intervalWeeks: 1,
        required: false,
        fields: ["waist"],
      },
      finalEvaluation: { enabled: true },
    });
    const missions = buildTrackingMissions({
      plan: {
        _id: "plan-1",
        startDate: new Date("2026-09-09T00:00:00.000Z"),
        endDate: new Date("2026-09-09T00:00:00.000Z"),
        scheduleMode: "fixed",
        weeklySchedule: [{ dayIndex: 3, type: "training" }],
      },
      followUp: policy,
      todayKey: "2026-09-09",
      todayCheckIn: null,
      todayWeight: null,
      todayPhotos: [],
      todayMeasurement: null,
      finalAssessment: null,
    });
    expect(missions.map((mission) => mission.type)).toEqual([
      "check_in",
      "weight",
      "photos",
      "measurements",
      "final_evaluation",
    ]);
    expect(missions.find((mission) => mission.type === "photos").required).toBe(
      false,
    );
  });

  test("mantiene pendiente la evaluación final si el plan fue completado antes de su fecha final", () => {
    const missions = buildTrackingMissions({
      plan: {
        _id: "plan-completed",
        status: "completed",
        startDate: "2026-09-01",
        endDate: "2026-10-31",
      },
      followUp: normalizeFollowUp({
        checkIn: { enabled: false },
        weight: { enabled: false },
        photos: { enabled: false },
        measurements: { enabled: false },
        finalEvaluation: { enabled: true },
      }),
      todayKey: "2026-09-09",
    });

    expect(missions).toEqual([
      expect.objectContaining({
        type: "final_evaluation",
        completed: false,
        planId: "plan-completed",
      }),
    ]);
  });

  test("restaura campos mínimos si se desmarcan todas las fotos o medidas", () => {
    const policy = normalizeFollowUp({
      photos: { views: [] },
      measurements: { fields: [] },
    });

    expect(policy.photos.views).toEqual(["front", "side", "back"]);
    expect(policy.measurements.fields).toEqual(["waist", "chest", "hips"]);
  });

  test("permite programar fotos cada tres días", () => {
    const followUp = normalizeFollowUp({
      checkIn: { enabled: false },
      weight: { enabled: false },
      photos: {
        enabled: true,
        frequencyInterval: 3,
        frequencyUnit: "day",
        views: ["front"],
      },
      measurements: { enabled: false },
      finalEvaluation: { enabled: false },
    });
    const plan = {
      _id: "plan-cadence",
      startDate: "2026-09-01",
      endDate: "2026-10-01",
    };

    expect(
      buildTrackingMissions({
        plan,
        followUp,
        todayKey: "2026-09-03",
        todayPhotos: [],
      }),
    ).toEqual([]);
    expect(
      buildTrackingMissions({
        plan,
        followUp,
        todayKey: "2026-09-04",
        todayPhotos: [],
      }),
    ).toEqual([expect.objectContaining({ type: "photos" })]);
  });
});
