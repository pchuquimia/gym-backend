import mongoose from "mongoose";

const PlanDaySchema = new mongoose.Schema(
  {
    slotId: { type: String, required: true },
    order: { type: Number, min: 1, max: 28, required: true },
    dayIndex: { type: Number, min: 1, max: 28, required: true },
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
    coachId: { type: String, default: null, index: true },
    createdById: {
      type: String,
      required: true,
      index: true,
      default() {
        return this.coachId || this.athleteId;
      },
    },
    athleteId: { type: String, required: true, index: true },
    planTemplateId: { type: String, default: null, index: true },
    planTemplateVersion: { type: Number, min: 1, default: null },
    planTemplateSnapshot: {
      name: { type: String, default: "" },
      version: { type: Number, default: null },
    },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    goal: { type: String, trim: true, maxlength: 80, default: "General" },
    durationWeeks: { type: Number, min: 1, max: 52, default: 8 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    scheduleMode: {
      type: String,
      enum: ["fixed", "flexible_guided", "sequential_cycle"],
      default: "fixed",
    },
    frequencyTarget: { type: Number, min: 1, max: 28, required: true },
    status: {
      type: String,
      enum: [
        "draft",
        "scheduled",
        "active",
        "paused",
        "completed",
        "cancelled",
      ],
      default: "active",
      index: true,
    },
    weeklySchedule: { type: [PlanDaySchema], default: [] },
    cycleProgress: {
      currentIndex: { type: Number, min: 0, default: 0 },
      completedCycles: { type: Number, min: 0, default: 0 },
      lastAdvancedAt: { type: Date, default: null },
      lastTrainingId: { type: String, default: null },
    },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true, versionKey: false },
);

TrainingPlanSchema.index({ athleteId: 1, status: 1, updatedAt: -1 });
TrainingPlanSchema.index({ coachId: 1, athleteId: 1, updatedAt: -1 });

TrainingPlanSchema.pre("validate", function normalizePlanDatesAndSlots(next) {
  if (!this.startDate) this.startDate = new Date();
  const start = new Date(this.startDate);
  start.setUTCHours(0, 0, 0, 0);
  this.startDate = start;

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Number(this.durationWeeks || 1) * 7 - 1);
  this.endDate = end;

  let trainingOrder = 0;
  this.weeklySchedule.forEach((day, index) => {
    if (!day.slotId) day.slotId = `slot_${day.dayIndex || index + 1}`;
    if (day.type === "training") trainingOrder += 1;
    day.order = day.type === "training" ? trainingOrder : index + 1;
  });
  this.frequencyTarget = this.weeklySchedule.filter(
    (day) => day.type === "training",
  ).length;
  if (this.scheduleMode !== "fixed" && this.weeklySchedule.length) {
    this.cycleProgress = this.cycleProgress || {};
    this.cycleProgress.currentIndex =
      Number(this.cycleProgress?.currentIndex || 0) %
      this.weeklySchedule.length;
  }
  next();
});

export default mongoose.model("TrainingPlan", TrainingPlanSchema);
