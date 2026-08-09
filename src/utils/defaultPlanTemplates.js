import PlanTemplate from "../models/PlanTemplate.js";

const fixedSchedule = (focuses) =>
  focuses.map((focus, index) => ({
    slotId: `slot_${index + 1}`,
    dayIndex: index + 1,
    type:
      focus === "Descanso"
        ? "rest"
        : focus === "Recuperacion"
          ? "recovery"
          : "training",
    focus: ["Descanso", "Recuperacion"].includes(focus) ? "" : focus,
    sourceRoutineId: null,
  }));

export const DEFAULT_PLAN_TEMPLATES = [
  {
    _id: "system_full_body_3",
    name: "Full body 3 dias",
    description: "Tres sesiones de cuerpo completo con recuperacion intermedia.",
    level: "beginner",
    goal: "Acondicionamiento",
    durationWeeks: 8,
    tags: ["3 dias", "principiante", "full body"],
    weeklySchedule: fixedSchedule([
      "Full body A",
      "Descanso",
      "Full body B",
      "Descanso",
      "Full body C",
      "Recuperacion",
      "Descanso",
    ]),
  },
  {
    _id: "system_upper_lower_4",
    name: "Superior e inferior 4 dias",
    description: "Frecuencia dos para tren superior e inferior.",
    level: "intermediate",
    goal: "Hipertrofia",
    durationWeeks: 8,
    tags: ["4 dias", "frecuencia 2"],
    weeklySchedule: fixedSchedule([
      "Tren superior A",
      "Tren inferior A",
      "Descanso",
      "Tren superior B",
      "Tren inferior B",
      "Recuperacion",
      "Descanso",
    ]),
  },
  {
    _id: "system_ppl_3",
    name: "Empuje, jale y piernas 3 dias",
    description: "Distribucion PPL con amplio tiempo de recuperacion.",
    level: "beginner",
    goal: "Hipertrofia",
    durationWeeks: 8,
    tags: ["3 dias", "ppl"],
    weeklySchedule: fixedSchedule([
      "Empuje",
      "Descanso",
      "Jale",
      "Descanso",
      "Piernas",
      "Recuperacion",
      "Descanso",
    ]),
  },
  {
    _id: "system_ppl_6",
    name: "Empuje, jale y piernas 6 dias",
    description: "PPL de frecuencia dos para atletas con mayor experiencia.",
    level: "advanced",
    goal: "Hipertrofia",
    durationWeeks: 8,
    tags: ["6 dias", "ppl", "frecuencia 2"],
    weeklySchedule: fixedSchedule([
      "Empuje A",
      "Jale A",
      "Piernas A",
      "Empuje B",
      "Jale B",
      "Piernas B",
      "Descanso",
    ]),
  },
  {
    _id: "system_strength_4",
    name: "Fuerza 4 dias",
    description: "Cuatro sesiones equilibradas con foco en patrones basicos.",
    level: "intermediate",
    goal: "Fuerza",
    durationWeeks: 10,
    tags: ["4 dias", "fuerza"],
    weeklySchedule: fixedSchedule([
      "Tren inferior fuerza",
      "Tren superior fuerza",
      "Descanso",
      "Tren inferior volumen",
      "Tren superior volumen",
      "Recuperacion",
      "Descanso",
    ]),
  },
  {
    _id: "system_return_3",
    name: "Retorno al entrenamiento",
    description: "Tres sesiones moderadas para recuperar consistencia.",
    level: "beginner",
    goal: "Retorno al entrenamiento",
    durationWeeks: 6,
    tags: ["3 dias", "retorno", "movilidad"],
    weeklySchedule: fixedSchedule([
      "Full body tecnico",
      "Movilidad",
      "Descanso",
      "Full body controlado",
      "Descanso",
      "Acondicionamiento",
      "Descanso",
    ]),
  },
];

export const ensureDefaultPlanTemplates = async () => {
  await PlanTemplate.bulkWrite(
    DEFAULT_PLAN_TEMPLATES.map((template) => ({
      updateOne: {
        filter: { _id: template._id },
        update: {
          $setOnInsert: {
            ...template,
            ownerId: null,
            visibility: "system",
            scheduleMode: "fixed",
            version: 1,
            isArchived: false,
          },
        },
        upsert: true,
      },
    })),
  );
};
