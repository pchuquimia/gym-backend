import "dotenv/config";
import mongoose from "mongoose";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";

const APPLY = process.argv.includes("--apply");
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const PLAN_ID = "6a7a05067cc130185c595f2b";
const SATURDAY_ROUTINE_ID =
  "dia-de-espalda-hombro-tricep-copy-1766079679766";
const SATURDAY_SCOPE_ID = "scope_1228ef64-76bc-445d-ab39-52c5e95c5a89";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");

const exerciseFromTraining = (exercise) => ({
  exerciseId: exercise.exerciseId,
  name: exercise.exerciseName || "Ejercicio",
  sets: Math.max(1, exercise.sets?.length || 3),
  supportsUnilateral: exercise.movementMode === "unilateral",
  movementMode:
    exercise.movementMode === "unilateral" ? "unilateral" : "bilateral",
  isExtra: false,
  muscle: exercise.muscleGroup || exercise.primaryMuscleGroup || "",
  alternatives: [],
});

await mongoose.connect(process.env.MONGO_URI);

try {
  const [plan, existingRoutine, latestTraining] = await Promise.all([
    TrainingPlan.findOne({ _id: PLAN_ID, athleteId: OWNER_ID }).lean(),
    Routine.findById(SATURDAY_ROUTINE_ID).lean(),
    Training.findOne({ ownerId: OWNER_ID, routineId: SATURDAY_ROUTINE_ID })
      .sort({ date: -1, createdAt: -1 })
      .lean(),
  ]);

  if (!plan) throw new Error("No se encontro la planificacion Mes 1 esperada");
  if (!latestTraining && !existingRoutine) {
    throw new Error("No existe una sesion historica para reconstruir el sabado");
  }

  const proposedRoutine = existingRoutine || {
    _id: SATURDAY_ROUTINE_ID,
    name: latestTraining.routineName || "Espalda · Hombro · Tríceps",
    description: `Restaurada desde la sesion del ${latestTraining.date}`,
    branch: latestTraining.branch || "sopocachi",
    exercises: (latestTraining.exercises || []).map(exerciseFromTraining),
    ownerId: OWNER_ID,
    progressScopeId: latestTraining.progressScopeId || SATURDAY_SCOPE_ID,
    progressMode: "inherit",
    sourceRoutineId: null,
    kind: "assigned",
    visibility: "private",
    version: 1,
    assignedByCoachId: null,
    assignedAt: null,
    trainingPlanId: PLAN_ID,
    trainingPlanSlotId: "slot_6",
    assignmentType: "plan",
    isArchived: false,
    isAvailableForTraining: plan.status === "active",
  };

  const preview = {
    apply: APPLY,
    plan: { id: String(plan._id), name: plan.name, status: plan.status },
    saturday: {
      routineExists: Boolean(existingRoutine),
      sourceTraining: latestTraining?.date || null,
      routineId: SATURDAY_ROUTINE_ID,
      name: proposedRoutine.name,
      exercises: proposedRoutine.exercises.map((exercise) => ({
        id: exercise.exerciseId,
        name: exercise.name,
        sets: exercise.sets,
        movementMode: exercise.movementMode,
      })),
    },
    normalization: {
      wednesdayFocus: "",
      fridayFocus: "Empuje",
      saturdayFocus: "Espalda · Hombro · Tríceps",
    },
  };

  if (!APPLY) {
    console.log(JSON.stringify(preview, null, 2));
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!existingRoutine) {
          await Routine.create([proposedRoutine], { session });
        } else {
          await Routine.updateOne(
            { _id: SATURDAY_ROUTINE_ID },
            {
              $set: {
                isArchived: false,
                isAvailableForTraining: plan.status === "active",
                archivedAt: null,
                archivedBy: null,
                archiveReason: null,
                trainingPlanId: PLAN_ID,
                trainingPlanSlotId: "slot_6",
                assignmentType: "plan",
              },
            },
            { session },
          );
        }

        const currentPlan = await TrainingPlan.findById(PLAN_ID).session(
          session,
        );
        const wednesday = currentPlan.weeklySchedule.find(
          (day) => day.slotId === "slot_3",
        );
        const friday = currentPlan.weeklySchedule.find(
          (day) => day.slotId === "slot_5",
        );
        const saturday = currentPlan.weeklySchedule.find(
          (day) => day.slotId === "slot_6",
        );
        if (!saturday || saturday.type !== "training") {
          throw new Error("El bloque de sabado ya no coincide con lo esperado");
        }
        if (wednesday?.type !== "training") wednesday.focus = "";
        if (friday) friday.focus = "Empuje";
        saturday.focus = "Espalda · Hombro · Tríceps";
        saturday.routineId = SATURDAY_ROUTINE_ID;
        saturday.sourceRoutineId = SATURDAY_ROUTINE_ID;
        await currentPlan.save({ session });
      });
      console.log(JSON.stringify({ ...preview, applied: true }, null, 2));
    } finally {
      await session.endSession();
    }
  }
} finally {
  await mongoose.disconnect();
}
