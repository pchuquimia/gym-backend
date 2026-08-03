import mongoose from "mongoose";

const PlanDaySchema = new mongoose.Schema(
  {
    dayIndex: { type: Number, min: 1, max: 7, required: true },
    type: {
      type: String,
      enum: ["training", "rest", "recovery"],
      default: "training",
    },
    focus: { type: String, trim: true, maxlength: 80, default: "" },
    sourceRoutineId: { type: String, default: null },
    routineId: { type: String, default: null },
  },
  { _id: false },
);

const TrainingPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    coachId: { type: String, required: true, index: true },
    athleteId: { type: String, required: true, index: true },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    goal: { type: String, trim: true, maxlength: 80, default: "General" },
    durationWeeks: { type: Number, min: 1, max: 52, default: 8 },
    startDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed"],
      default: "active",
      index: true,
    },
    weeklySchedule: { type: [PlanDaySchema], default: [] },
    progression: {
      strategy: {
        type: String,
        enum: ["double_progression", "linear", "rpe", "custom"],
        default: "double_progression",
      },
      deloadEveryWeeks: { type: Number, min: 0, max: 12, default: 4 },
    },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true, versionKey: false },
);

TrainingPlanSchema.index({ athleteId: 1, status: 1, updatedAt: -1 });
TrainingPlanSchema.index({ coachId: 1, athleteId: 1, updatedAt: -1 });

export default mongoose.model("TrainingPlan", TrainingPlanSchema);
