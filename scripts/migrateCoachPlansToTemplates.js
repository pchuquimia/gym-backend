import "dotenv/config";
import mongoose from "mongoose";
import PlanTemplate from "../src/models/PlanTemplate.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import User from "../src/models/User.js";

const apply = process.argv.includes("--apply");
if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");

await mongoose.connect(process.env.MONGO_URI);

try {
  const coaches = await User.find({ role: "Entrenador" }, "_id").lean();
  const coachIds = coaches.map((coach) => String(coach._id));
  const legacyPlans = await TrainingPlan.find({
    athleteId: { $in: coachIds },
    coachId: null,
    status: { $in: ["draft", "cancelled"] },
  }).lean();

  console.log(`Planes personales de coach encontrados: ${legacyPlans.length}`);
  if (!apply) {
    console.log("Simulacion terminada. Ejecuta con --apply para guardar.");
  } else {
    const templateOperations = legacyPlans.map((plan) => ({
      updateOne: {
        filter: { _id: `legacy_${plan._id}` },
        update: {
          $setOnInsert: {
            name: plan.name,
            description: plan.notes || "Migrada desde planificacion personal",
            ownerId: String(plan.athleteId),
            visibility: "private",
            level: plan.level || "beginner",
            goal: plan.goal || "General",
            durationWeeks: Number(plan.durationWeeks || 8),
            scheduleMode:
              plan.scheduleMode === "fixed" ? "fixed" : "sequential_cycle",
            weeklySchedule: (plan.weeklySchedule || []).map((day, index) => ({
              slotId: `slot_${index + 1}`,
              dayIndex: index + 1,
              type: day.type || "training",
              focus: day.focus || "",
              sourceRoutineId:
                day.type === "training"
                  ? day.sourceRoutineId || day.routineId || null
                  : null,
            })),
            tags: ["migrada"],
            version: 1,
            isArchived: plan.status === "cancelled",
          },
        },
        upsert: true,
      },
    }));
    if (templateOperations.length) {
      await PlanTemplate.bulkWrite(templateOperations, { ordered: false });
      await TrainingPlan.updateMany(
        { _id: { $in: legacyPlans.map((plan) => plan._id) } },
        { $set: { status: "cancelled" } },
      );
    }
    console.log("Planes de coach migrados a plantillas reutilizables.");
  }
} finally {
  await mongoose.disconnect();
}
