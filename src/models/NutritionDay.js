import mongoose from "mongoose";
import { NutritionSnapshotSchema } from "./NutritionPlan.js";
import { isoDateKey, maxArrayLength } from "./schemaValidation.js";

const schema = new mongoose.Schema(
  {
    athleteId: { type: String, required: true },
    coachId: { type: String, required: true },
    planId: { type: String, required: true },
    dateKey: isoDateKey(),
    snapshot: { type: NutritionSnapshotSchema, required: true },
    completedMealIds: {
      type: [String],
      default: [],
      validate: maxArrayLength(8, "Las comidas completadas"),
    },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ athleteId: 1, coachId: 1, dateKey: 1 }, { unique: true });
export default mongoose.model("NutritionDay", schema);
