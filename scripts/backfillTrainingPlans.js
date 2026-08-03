import "dotenv/config";
import mongoose from "mongoose";
import TrainingPlan from "../src/models/TrainingPlan.js";

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) throw new Error("MONGO_URI no esta configurado");

await mongoose.connect(mongoUri);

try {
  const plans = await TrainingPlan.find({});
  let updated = 0;

  for (const plan of plans) {
    plan.createdById ||= plan.coachId || plan.athleteId;
    plan.startDate ||= plan.createdAt || new Date();
    plan.scheduleMode ||= "fixed";
    plan.weeklySchedule.forEach((day, index) => {
      day.slotId ||= `slot_${day.dayIndex || index + 1}`;
    });
    await plan.save();
    updated += 1;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await TrainingPlan.updateMany(
    { status: "active", startDate: { $gt: today } },
    { $set: { status: "scheduled" } },
  );
  await TrainingPlan.collection.updateMany(
    {},
    { $unset: { muscleFrequency: "", progression: "" } },
  );

  console.log(`Planificaciones actualizadas: ${updated}`);
} finally {
  await mongoose.disconnect();
}
