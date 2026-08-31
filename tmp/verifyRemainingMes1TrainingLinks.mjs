import "dotenv/config";
import mongoose from "mongoose";
import { getMongoConnectionOptions } from "../src/config/db.js";
import Training from "../src/models/Training.js";

const PLAN_ID = "6a7a05067cc130185c595f2b";
const OWNER_ID = "6a3ca03e2b24c3fe587f32aa";
const ids = [
  "training_6cc0e7a9-cab1-4f46-a262-541169fdae98",
  "training_b301f048-1cff-47e1-8390-1e1a21d24693",
  "training_cd8c9843-81fb-40f3-a6bd-d7e27daefd46",
];

await mongoose.connect(process.env.MONGO_URI, getMongoConnectionOptions());
try {
  const sessions = await Training.find(
    { _id: { $in: ids }, ownerId: OWNER_ID },
    "date routineName trainingPlanId trainingPlanSlotId exercises.exerciseId",
  )
    .sort({ date: 1 })
    .lean();
  const linkedSessions = await Training.countDocuments({
    ownerId: OWNER_ID,
    trainingPlanId: PLAN_ID,
  });
  console.log(
    JSON.stringify(
      {
        sessions: sessions.map((training) => ({
          date: training.date,
          routine: training.routineName,
          planId: training.trainingPlanId,
          slotId: training.trainingPlanSlotId,
          exercises: training.exercises?.length || 0,
        })),
        linkedSessions,
        repaired: sessions.every(
          (training) => String(training.trainingPlanId || "") === PLAN_ID,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
