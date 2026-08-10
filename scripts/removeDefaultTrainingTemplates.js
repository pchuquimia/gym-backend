import "dotenv/config";
import mongoose from "mongoose";
import PlanTemplate from "../src/models/PlanTemplate.js";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";

const apply = process.argv.includes("--apply");
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) throw new Error("MONGO_URI no esta configurado");

const defaultRoutineFilter = {
  $or: [
    { _id: /^system_routine_/ },
    { visibility: "system", kind: "template" },
  ],
};

const defaultPlanTemplateFilter = {
  $or: [{ _id: /^system_/ }, { visibility: "system" }],
};

await mongoose.connect(mongoUri);

try {
  const [defaultRoutines, defaultPlanTemplates] = await Promise.all([
    Routine.find(defaultRoutineFilter, "_id name").lean(),
    PlanTemplate.find(defaultPlanTemplateFilter, "_id name").lean(),
  ]);
  const routineIds = defaultRoutines.map((routine) => String(routine._id));
  const planTemplateIds = defaultPlanTemplates.map((plan) => String(plan._id));
  const trainingPlanReferenceFilters = [
    ...(planTemplateIds.length
      ? [{ planTemplateId: { $in: planTemplateIds } }]
      : []),
    ...(routineIds.length
      ? [
          { "weeklySchedule.sourceRoutineId": { $in: routineIds } },
          { "weeklySchedule.routineId": { $in: routineIds } },
        ]
      : []),
  ];

  const referenceCounts = {
    assignedRoutineCopies: routineIds.length
      ? await Routine.countDocuments({
          sourceRoutineId: { $in: routineIds },
          _id: { $nin: routineIds },
        })
      : 0,
    privatePlanTemplates: routineIds.length
      ? await PlanTemplate.countDocuments({
          "weeklySchedule.sourceRoutineId": { $in: routineIds },
          _id: { $nin: planTemplateIds },
        })
      : 0,
    trainingPlans: trainingPlanReferenceFilters.length
      ? await TrainingPlan.countDocuments({
          $or: trainingPlanReferenceFilters,
        })
      : 0,
    trainings: routineIds.length
      ? await Training.countDocuments({ routineId: { $in: routineIds } })
      : 0,
  };

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        defaultRoutines: defaultRoutines.map((routine) => ({
          id: routine._id,
          name: routine.name,
        })),
        defaultPlanTemplates: defaultPlanTemplates.map((plan) => ({
          id: plan._id,
          name: plan.name,
        })),
        referencesPreserved: referenceCounts,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Simulacion terminada. Ejecuta con --apply para eliminar.");
  } else {
    if (routineIds.length) {
      await Promise.all([
        Routine.updateMany(
          {
            sourceRoutineId: { $in: routineIds },
            _id: { $nin: routineIds },
          },
          { $set: { sourceRoutineId: null, sourceRoutineVersion: null } },
        ),
        PlanTemplate.updateMany(
          {
            "weeklySchedule.sourceRoutineId": { $in: routineIds },
            _id: { $nin: planTemplateIds },
          },
          { $set: { "weeklySchedule.$[day].sourceRoutineId": null } },
          { arrayFilters: [{ "day.sourceRoutineId": { $in: routineIds } }] },
        ),
        TrainingPlan.updateMany(
          { "weeklySchedule.sourceRoutineId": { $in: routineIds } },
          { $set: { "weeklySchedule.$[day].sourceRoutineId": null } },
          { arrayFilters: [{ "day.sourceRoutineId": { $in: routineIds } }] },
        ),
        TrainingPlan.updateMany(
          { "weeklySchedule.routineId": { $in: routineIds } },
          {
            $set: {
              "weeklySchedule.$[day].routineId": null,
              "weeklySchedule.$[day].sourceRoutineId": null,
            },
          },
          { arrayFilters: [{ "day.routineId": { $in: routineIds } }] },
        ),
        Training.updateMany(
          { routineId: { $in: routineIds } },
          { $set: { routineId: null } },
        ),
      ]);
    }

    if (planTemplateIds.length) {
      await TrainingPlan.updateMany(
        { planTemplateId: { $in: planTemplateIds } },
        {
          $set: {
            planTemplateId: null,
            planTemplateVersion: null,
          },
        },
      );
    }

    const [routineResult, planResult] = await Promise.all([
      Routine.deleteMany(defaultRoutineFilter),
      PlanTemplate.deleteMany(defaultPlanTemplateFilter),
    ]);

    console.log(
      `Eliminadas ${routineResult.deletedCount} rutinas y ${planResult.deletedCount} planificaciones predeterminadas.`,
    );
  }
} finally {
  await mongoose.disconnect();
}
