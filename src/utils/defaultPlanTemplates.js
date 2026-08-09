import PlanTemplate from "../models/PlanTemplate.js";
import { ensureDefaultRoutineTemplates } from "./defaultRoutineTemplates.js";

const fixedSchedule = (items) =>
  items.map((item, index) => {
    const [focus, sourceRoutineId = null] = Array.isArray(item)
      ? item
      : [item, null];
    return {
      slotId: `slot_${index + 1}`,
      dayIndex: index + 1,
      type:
        focus === "Descanso"
          ? "rest"
          : focus === "Recuperacion"
            ? "recovery"
            : "training",
      focus: ["Descanso", "Recuperacion"].includes(focus) ? "" : focus,
      sourceRoutineId,
    };
  });

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
      ["Full body A", "system_routine_full_body_a"],
      "Descanso",
      ["Full body B", "system_routine_full_body_b"],
      "Descanso",
      ["Full body C", "system_routine_full_body_c"],
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
      ["Tren superior A", "system_routine_upper_a"],
      ["Tren inferior A", "system_routine_lower_a"],
      "Descanso",
      ["Tren superior B", "system_routine_upper_b"],
      ["Tren inferior B", "system_routine_lower_b"],
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
      ["Empuje", "system_routine_push_a"],
      "Descanso",
      ["Jale", "system_routine_pull_a"],
      "Descanso",
      ["Piernas", "system_routine_legs_a"],
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
      ["Empuje A", "system_routine_push_a"],
      ["Jale A", "system_routine_pull_a"],
      ["Piernas A", "system_routine_legs_a"],
      ["Empuje B", "system_routine_push_b"],
      ["Jale B", "system_routine_pull_b"],
      ["Piernas B", "system_routine_legs_b"],
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
      ["Tren inferior fuerza", "system_routine_strength_lower"],
      ["Tren superior fuerza", "system_routine_strength_upper"],
      "Descanso",
      ["Tren inferior volumen", "system_routine_volume_lower"],
      ["Tren superior volumen", "system_routine_volume_upper"],
      "Recuperacion",
      "Descanso",
    ]),
  },
  {
    _id: "system_return_3",
    name: "Retorno al entrenamiento",
    description: "Tres sesiones moderadas y una sesion de movilidad para recuperar consistencia.",
    level: "beginner",
    goal: "Retorno al entrenamiento",
    durationWeeks: 6,
    tags: ["4 dias", "retorno", "movilidad"],
    weeklySchedule: fixedSchedule([
      ["Full body tecnico", "system_routine_return_technical"],
      ["Movilidad", "system_routine_mobility"],
      "Descanso",
      ["Full body controlado", "system_routine_return_controlled"],
      "Descanso",
      ["Acondicionamiento", "system_routine_conditioning"],
      "Descanso",
    ]),
  },
];

export const ensureDefaultPlanTemplates = async ({ force = false } = {}) => {
  await ensureDefaultRoutineTemplates();
  await PlanTemplate.bulkWrite(
    DEFAULT_PLAN_TEMPLATES.map(({ _id, weeklySchedule, ...template }) => ({
      updateOne: {
        filter: { _id },
        update: force
          ? {
              $set: {
                ...template,
                weeklySchedule,
                ownerId: null,
                visibility: "system",
                scheduleMode: "fixed",
                version: 1,
                isArchived: false,
              },
            }
          : {
              $setOnInsert: {
                ...template,
                weeklySchedule,
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
