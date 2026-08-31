import "dotenv/config";
import mongoose from "mongoose";
import { getMongoConnectionOptions } from "../src/config/db.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";

const APPLY = process.argv.includes("--apply");
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const PLAN_ID = "6a7a05067cc130185c595f2b";
const TARGETS = [
  { date: "2026-08-11", routineName: "UPPER" },
  { date: "2026-08-14", routineName: "PUSH" },
  { date: "2026-08-15", routineName: "PULL" },
];

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
await mongoose.connect(process.env.MONGO_URI, getMongoConnectionOptions());

try {
  const plan = await TrainingPlan.findOne({
    _id: PLAN_ID,
    athleteId: OWNER_ID,
    status: "active",
  }).lean();
  if (!plan) throw new Error("No se encontró el plan Mes 1 activo esperado");

  const scheduledRoutineIds = (plan.weeklySchedule || [])
    .filter((day) => day.type === "training" && day.routineId)
    .map((day) => String(day.routineId));
  const proposed = [];

  for (const target of TARGETS) {
    const trainings = await Training.find({
      ownerId: OWNER_ID,
      date: target.date,
      routineId: { $in: scheduledRoutineIds },
      routineName: target.routineName,
      $or: [
        { trainingPlanId: null },
        { trainingPlanId: "" },
        { trainingPlanId: { $exists: false } },
      ],
    }).lean();
    if (trainings.length !== 1) {
      throw new Error(
        `Se esperaba una sesión ${target.routineName} sin plan el ${target.date}; encontradas: ${trainings.length}`,
      );
    }

    const training = trainings[0];
    const matchingSlots = (plan.weeklySchedule || []).filter(
      (day) =>
        day.type === "training" &&
        String(day.routineId || "") === String(training.routineId),
    );
    if (matchingSlots.length !== 1) {
      throw new Error(
        `La rutina ${training.routineId} no tiene un bloque único en el plan`,
      );
    }

    proposed.push({
      trainingId: String(training._id),
      date: training.date,
      routineId: training.routineId,
      routineName: training.routineName,
      exerciseCount: training.exercises?.length || 0,
      trainingPlanId: PLAN_ID,
      trainingPlanSlotId: String(matchingSlots[0].slotId),
    });
  }

  if (!APPLY) {
    console.log(JSON.stringify({ apply: false, plan: plan.name, proposed }, null, 2));
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of proposed) {
          const result = await Training.updateOne(
            {
              _id: item.trainingId,
              ownerId: OWNER_ID,
              $or: [
                { trainingPlanId: null },
                { trainingPlanId: "" },
                { trainingPlanId: { $exists: false } },
              ],
            },
            {
              $set: {
                trainingPlanId: item.trainingPlanId,
                trainingPlanSlotId: item.trainingPlanSlotId,
              },
            },
            { session },
          );
          if (result.modifiedCount !== 1) {
            throw new Error(`No se pudo asociar la sesión ${item.trainingId}`);
          }
        }
      });
    } finally {
      await session.endSession();
    }

    const start = new Date(plan.startDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + Number(plan.durationWeeks || 1) * 7 - 1);
    const remainingMissing = await Training.countDocuments({
      ownerId: OWNER_ID,
      date: {
        $gte: start.toISOString().slice(0, 10),
        $lte: end.toISOString().slice(0, 10),
      },
      routineId: { $in: scheduledRoutineIds },
      trainingPlanId: { $ne: PLAN_ID },
    });
    const linkedSessions = await Training.countDocuments({
      ownerId: OWNER_ID,
      trainingPlanId: PLAN_ID,
    });

    console.log(
      JSON.stringify(
        {
          apply: true,
          plan: plan.name,
          repaired: proposed,
          linkedSessions,
          remainingMissing,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await mongoose.disconnect();
}
