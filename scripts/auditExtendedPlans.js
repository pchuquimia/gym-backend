import "dotenv/config";
import mongoose from "mongoose";
import { getMongoConnectionOptions } from "../src/config/db.js";

try {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurado");
  await mongoose.connect(process.env.MONGO_URI, {
    ...getMongoConnectionOptions(),
    autoIndex: false,
    autoCreate: false,
  });
  const db = mongoose.connection.db;
  const plans = await db.collection("trainingplans").find({}).toArray();
  const byId = new Map(plans.map((plan) => [String(plan._id), plan]));
  const children = plans.filter((plan) => plan.sourcePlanId && !plan.coachId);
  const report = [];
  for (const plan of children) {
    const source = byId.get(String(plan.sourcePlanId));
    const id = String(plan._id);
    report.push({
      id,
      name: plan.name,
      sourceId: plan.sourcePlanId,
      sourceName: source?.name,
      sameOwner: source?.athleteId === plan.athleteId,
      sourceCoach: Boolean(source?.coachId),
      status: plan.status,
      sourceStatus: source?.status,
      start: plan.startDate,
      end: plan.endDate,
      durationWeeks: plan.durationWeeks,
      sourceStart: source?.startDate,
      sourceEnd: source?.endDate,
      scheduleMode: plan.scheduleMode,
      sourceScheduleMode: source?.scheduleMode,
      slots: (plan.weeklySchedule || []).map((slot) => ({
        slotId: slot.slotId,
        type: slot.type,
        routineId: slot.routineId,
      })),
      sourceSlots: (source?.weeklySchedule || []).map((slot) => ({
        slotId: slot.slotId,
        type: slot.type,
        routineId: slot.routineId,
      })),
      trainings: await db
        .collection("trainings")
        .countDocuments({ trainingPlanId: id }),
      routines: await db
        .collection("routines")
        .countDocuments({ trainingPlanId: id }),
      assessments: await db
        .collection("athleteassessments")
        .countDocuments({ planId: id }),
      measurements: await db
        .collection("athletemeasurements")
        .countDocuments({ planId: id }),
    });
  }
  console.log(
    JSON.stringify(
      {
        database: db.databaseName,
        totalPlans: plans.length,
        continuationCount: children.length,
        continuations: report,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    "No se pudo auditar las extensiones:",
    error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, "[conexión]"),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
