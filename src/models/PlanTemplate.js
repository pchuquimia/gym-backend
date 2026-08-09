import mongoose from "mongoose";

const PlanTemplateDaySchema = new mongoose.Schema(
  {
    slotId: { type: String, required: true },
    dayIndex: { type: Number, min: 1, max: 28, required: true },
    type: {
      type: String,
      enum: ["training", "rest", "recovery"],
      default: "training",
    },
    focus: { type: String, trim: true, maxlength: 80, default: "" },
    sourceRoutineId: { type: String, default: null },
  },
  { _id: false },
);

const PlanTemplateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    ownerId: { type: String, default: null, index: true },
    visibility: {
      type: String,
      enum: ["system", "private"],
      default: "private",
      index: true,
    },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    goal: { type: String, trim: true, maxlength: 80, default: "General" },
    durationWeeks: { type: Number, min: 1, max: 52, default: 8 },
    scheduleMode: {
      type: String,
      enum: ["fixed", "sequential_cycle"],
      default: "fixed",
    },
    weeklySchedule: { type: [PlanTemplateDaySchema], default: [] },
    tags: { type: [String], default: [] },
    version: { type: Number, min: 1, default: 1 },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false },
);

PlanTemplateSchema.index({ visibility: 1, ownerId: 1, isArchived: 1 });

export default mongoose.model("PlanTemplate", PlanTemplateSchema);
