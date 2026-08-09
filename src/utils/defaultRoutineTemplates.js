import Exercise from "../models/Exercise.js";
import Routine from "../models/Routine.js";

const getTemplateMetadata = (id) => {
  if (id.includes("full_body_")) {
    return {
      templateGroup: "full_body",
      goal: "Acondicionamiento",
      level: "beginner",
      tags: ["full body", "3 dias"],
    };
  }
  if (id.includes("upper_") || id.includes("lower_")) {
    return {
      templateGroup: "upper_lower",
      goal: "Hipertrofia",
      level: "intermediate",
      tags: ["superior e inferior", "frecuencia 2"],
    };
  }
  if (
    id.includes("push_") ||
    id.includes("pull_") ||
    id.includes("legs_")
  ) {
    return {
      templateGroup: "ppl",
      goal: "Hipertrofia",
      level: "intermediate",
      tags: ["empuje jale piernas", "ppl"],
    };
  }
  if (id.includes("strength_") || id.includes("volume_")) {
    return {
      templateGroup: "strength",
      goal: id.includes("strength_") ? "Fuerza" : "Volumen",
      level: "intermediate",
      tags: ["fuerza", "4 dias"],
    };
  }
  return {
    templateGroup: "return",
    goal: id.includes("mobility") ? "Movilidad" : "Retorno",
    level: "beginner",
    tags: ["retorno", "tecnica"],
  };
};

const routine = (id, name, description, exerciseIds) => ({
  _id: id,
  name,
  description,
  ...getTemplateMetadata(id),
  exerciseIds,
});

export const DEFAULT_ROUTINE_TEMPLATES = [
  routine("system_routine_full_body_a", "Full body A", "Base tecnica equilibrada con maquinas y patrones fundamentales.", [
    ["dataset-hasane-2287", 3], ["dataset-hasane-1301", 3], ["dataset-hasane-0673", 3],
    ["dataset-hasane-0586", 3], ["dataset-hasane-0587", 2], ["dataset-hasane-0276", 3],
  ]),
  routine("system_routine_full_body_b", "Full body B", "Trabajo global con peso libre moderado, estabilidad y control.", [
    ["dataset-hasane-1760", 3], ["dataset-hasane-1350", 3], ["dataset-hasane-3216", 3],
    ["dataset-hasane-1459", 3], ["dataset-hasane-0178", 2], ["dataset-hasane-0979", 3],
  ]),
  routine("system_routine_full_body_c", "Full body C", "Sesion unilateral y global para completar la semana sin repetir estimulos.", [
    ["dataset-hasane-1460", 3], ["dataset-hasane-0314", 3], ["dataset-hasane-0017", 3],
    ["dataset-hasane-1409", 3], ["dataset-hasane-0294", 2], ["dataset-hasane-0241", 2],
  ]),
  routine("system_routine_upper_a", "Tren superior A", "Empuje y traccion horizontal con volumen equilibrado.", [
    ["dataset-hasane-0025", 4], ["dataset-hasane-0180", 4], ["dataset-hasane-0587", 3],
    ["dataset-hasane-2330", 3], ["dataset-hasane-0178", 3], ["dataset-hasane-0294", 2], ["dataset-hasane-0241", 2],
  ]),
  routine("system_routine_lower_a", "Tren inferior A", "Dominante de rodilla y bisagra con core estable.", [
    ["dataset-hasane-0043", 4], ["dataset-hasane-0085", 4], ["dataset-hasane-2287", 3],
    ["dataset-hasane-0586", 3], ["dataset-hasane-1373", 3], ["dataset-hasane-0276", 3],
  ]),
  routine("system_routine_upper_b", "Tren superior B", "Segundo estimulo superior con angulos y agarres complementarios.", [
    ["dataset-hasane-0314", 4], ["dataset-hasane-1326", 4], ["dataset-hasane-1350", 3],
    ["dataset-hasane-0587", 3], ["dataset-hasane-3697", 3], ["dataset-hasane-0031", 3], ["dataset-hasane-0241", 3],
  ]),
  routine("system_routine_lower_b", "Tren inferior B", "Segundo estimulo inferior con enfasis en gluteos y accesorios.", [
    ["dataset-hasane-0042", 4], ["dataset-hasane-1409", 4], ["dataset-hasane-0585", 3],
    ["dataset-hasane-0599", 3], ["dataset-hasane-1460", 3], ["dataset-hasane-1373", 3], ["dataset-hasane-0979", 3],
  ]),
  routine("system_routine_push_a", "Empuje A", "Pecho, hombros y triceps con prioridad en fuerza tecnica.", [
    ["dataset-hasane-0025", 4], ["dataset-hasane-0314", 3], ["dataset-hasane-0587", 3],
    ["dataset-hasane-0178", 3], ["dataset-hasane-0241", 3],
  ]),
  routine("system_routine_pull_a", "Jale A", "Espalda y biceps con traccion vertical y horizontal.", [
    ["dataset-hasane-2330", 4], ["dataset-hasane-0180", 4], ["dataset-hasane-3697", 3],
    ["dataset-hasane-0294", 3], ["dataset-hasane-0979", 3],
  ]),
  routine("system_routine_legs_a", "Piernas A", "Piernas completas con base de sentadilla y bisagra.", [
    ["dataset-hasane-0043", 4], ["dataset-hasane-0085", 4], ["dataset-hasane-2287", 3],
    ["dataset-hasane-0586", 3], ["dataset-hasane-1373", 4], ["dataset-hasane-0276", 3],
  ]),
  routine("system_routine_push_b", "Empuje B", "Segundo empuje con inclinacion, hombro y final metabolico.", [
    ["dataset-hasane-0047", 4], ["dataset-hasane-1301", 3], ["dataset-hasane-1456", 3],
    ["dataset-hasane-0311", 3], ["dataset-hasane-0241", 3], ["dataset-hasane-3216", 2],
  ]),
  routine("system_routine_pull_b", "Jale B", "Segundo jale con dominada, remo, agarre y brazos.", [
    ["dataset-hasane-1326", 4], ["dataset-hasane-1350", 4], ["dataset-hasane-1022", 3],
    ["dataset-hasane-0031", 3], ["dataset-hasane-2133", 3],
  ]),
  routine("system_routine_legs_b", "Piernas B", "Segundo dia de piernas con enfasis posterior y gluteos.", [
    ["dataset-hasane-0042", 4], ["dataset-hasane-0032", 3], ["dataset-hasane-1409", 4],
    ["dataset-hasane-0585", 3], ["dataset-hasane-0599", 3], ["dataset-hasane-0088", 4],
  ]),
  routine("system_routine_strength_lower", "Tren inferior fuerza", "Sesion de fuerza centrada en sentadilla, peso muerto y estabilidad.", [
    ["dataset-hasane-0043", 5], ["dataset-hasane-0032", 3], ["dataset-hasane-2287", 3],
    ["dataset-hasane-0586", 3], ["dataset-hasane-0979", 3],
  ]),
  routine("system_routine_strength_upper", "Tren superior fuerza", "Sesion de fuerza centrada en press, remo y dominada.", [
    ["dataset-hasane-0025", 5], ["dataset-hasane-0180", 5], ["dataset-hasane-1456", 4],
    ["dataset-hasane-1326", 4], ["dataset-hasane-0241", 3],
  ]),
  routine("system_routine_volume_lower", "Tren inferior volumen", "Volumen accesorio para cuadriceps, cadena posterior y pantorrillas.", [
    ["dataset-hasane-0042", 4], ["dataset-hasane-0085", 4], ["dataset-hasane-2287", 4],
    ["dataset-hasane-0585", 3], ["dataset-hasane-0599", 3], ["dataset-hasane-1373", 4],
  ]),
  routine("system_routine_volume_upper", "Tren superior volumen", "Volumen equilibrado de pecho, espalda, hombros y brazos.", [
    ["dataset-hasane-0314", 4], ["dataset-hasane-2330", 4], ["dataset-hasane-1350", 4],
    ["dataset-hasane-0587", 3], ["dataset-hasane-0178", 3], ["dataset-hasane-0294", 3], ["dataset-hasane-0241", 3],
  ]),
  routine("system_routine_return_technical", "Full body tecnico", "Reintroduccion de patrones con baja complejidad y esfuerzo moderado.", [
    ["dataset-hasane-1760", 2], ["dataset-hasane-1301", 2], ["dataset-hasane-1350", 2],
    ["dataset-hasane-3561", 2], ["dataset-hasane-0276", 2], ["dataset-hasane-3666", 1],
  ]),
  routine("system_routine_mobility", "Movilidad", "Secuencia global para cadera, columna, hombros e isquiotibiales.", [
    ["dataset-hasane-1604", 2], ["dataset-hasane-1564", 2], ["dataset-hasane-1511", 2],
    ["dataset-hasane-1271", 2], ["dataset-hasane-1363", 2], ["dataset-hasane-0690", 2],
  ]),
  routine("system_routine_return_controlled", "Full body controlado", "Progresion moderada en maquinas antes de elevar intensidad.", [
    ["dataset-hasane-2287", 3], ["dataset-hasane-1301", 3], ["dataset-hasane-0673", 3],
    ["dataset-hasane-0599", 2], ["dataset-hasane-0587", 2], ["dataset-hasane-0979", 2],
  ]),
  routine("system_routine_conditioning", "Acondicionamiento", "Circuito de bajo impacto con transporte, core y cardio regulable.", [
    ["dataset-hasane-3666", 1], ["dataset-hasane-2133", 3], ["dataset-hasane-0630", 3],
    ["dataset-hasane-2141", 1], ["dataset-hasane-0276", 2],
  ]),
];

const toRoutineExercise = (exercise, sets) => ({
  exerciseId: exercise._id,
  name: exercise.localizedNames?.es || exercise.name,
  sets,
  supportsUnilateral: Boolean(exercise.supportsUnilateral),
  movementMode: exercise.movementMode || "bilateral",
  muscle: exercise.primaryMuscleGroup || exercise.muscle || "",
  image: exercise.image || exercise.media?.image?.url || "",
  imagePublicId: exercise.imagePublicId || exercise.media?.image?.publicId || "",
  alternatives: [],
});

export const ensureDefaultRoutineTemplates = async ({ force = false } = {}) => {
  const routineIds = DEFAULT_ROUTINE_TEMPLATES.map((item) => item._id);
  if (!force) {
    const existingCount = await Routine.countDocuments({
      _id: { $in: routineIds },
      visibility: "system",
      kind: "template",
      isArchived: { $ne: true },
    });
    if (existingCount === routineIds.length) {
      return { routineCount: existingCount, exerciseCount: null, changed: false };
    }
  }
  const exerciseIds = [...new Set(DEFAULT_ROUTINE_TEMPLATES.flatMap((item) => item.exerciseIds.map(([id]) => id)))];
  const exercises = await Exercise.find({
    _id: { $in: exerciseIds },
    isActive: true,
    mergedIntoExerciseId: null,
  }).lean();
  const exercisesById = new Map(exercises.map((exercise) => [String(exercise._id), exercise]));
  const missingIds = exerciseIds.filter((id) => !exercisesById.has(id));
  if (missingIds.length) {
    throw new Error(`No se pueden crear las rutinas base. Faltan ejercicios: ${missingIds.join(", ")}`);
  }

  await Routine.bulkWrite(
    DEFAULT_ROUTINE_TEMPLATES.map(({ exerciseIds: routineExerciseIds, ...template }) => ({
      updateOne: {
        filter: { _id: template._id },
        update: {
          $set: {
            ...template,
            branch: "general",
            exercises: routineExerciseIds.map(([id, sets]) => toRoutineExercise(exercisesById.get(id), sets)),
            ownerId: null,
            kind: "template",
            visibility: "system",
            version: 1,
            progressMode: "fresh",
            progressScopeId: `scope_${template._id}`,
            assignmentType: "personal",
            isArchived: false,
            isAvailableForTraining: false,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    routineCount: DEFAULT_ROUTINE_TEMPLATES.length,
    exerciseCount: exerciseIds.length,
    changed: true,
  };
};
