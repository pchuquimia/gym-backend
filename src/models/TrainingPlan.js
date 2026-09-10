import mongoose from "mongoose";
import { maxArrayLength } from "./schemaValidation.js";

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
    sourcePlanId: { type: String, default: null, index: true },
    sourcePlanSnapshot: {
      name: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
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
    weeklySchedule: {
      type: [PlanDaySchema],
      default: [],
      validate: [
        maxArrayLength(28, "La planificacion semanal"),
        {
          validator: (days) =>
            new Set((days || []).map((day) => day.slotId)).size ===
            (days || []).length,
          message: "Los identificadores de bloque deben ser unicos",
        },
        {
          validator: (days) =>
            new Set((days || []).map((day) => day.dayIndex)).size ===
            (days || []).length,
          message: "Los indices de dia deben ser unicos",
        },
      ],
    },
    cycleProgress: {
      currentIndex: { type: Number, min: 0, default: 0 },
      completedCycles: { type: Number, min: 0, default: 0 },
      lastAdvancedAt: { type: Date, default: null },
      lastTrainingId: { type: String, default: null },
    },
    followUp: {
      useCoachDefaults: { type: Boolean, default: true },
      checkIn: {
        enabled: { type: Boolean, default: true },
        cadence: {
          type: String,
          enum: ["daily", "workout_days", "weekly"],
          default: "workout_days",
        },
        weekdays: { type: [Number], default: [] },
      },
      weight: {
        enabled: { type: Boolean, default: true },
        intervalWeeks: { type: Number, min: 1, max: 12, default: 1 },
        frequencyInterval: { type: Number, min: 1, max: 90, default: 1 },
        frequencyUnit: {
          type: String,
          enum: ["day", "week", "month"],
          default: "week",
        },
        weekday: { type: Number, min: 1, max: 7, default: 1 },
        required: { type: Boolean, default: true },
      },
      photos: {
        enabled: { type: Boolean, default: true },
        intervalWeeks: { type: Number, min: 1, max: 12, default: 4 },
        frequencyInterval: { type: Number, min: 1, max: 90, default: 4 },
        frequencyUnit: {
          type: String,
          enum: ["day", "week", "month"],
          default: "week",
        },
        views: { type: [String], default: ["front", "side", "back"] },
        required: { type: Boolean, default: false },
      },
      measurements: {
        enabled: { type: Boolean, default: true },
        intervalWeeks: { type: Number, min: 1, max: 12, default: 4 },
        frequencyInterval: { type: Number, min: 1, max: 90, default: 4 },
        frequencyUnit: {
          type: String,
          enum: ["day", "week", "month"],
          default: "week",
        },
        fields: { type: [String], default: ["waist", "chest", "hips"] },
        required: { type: Boolean, default: false },
      },
      review: {
        enabled: { type: Boolean, default: true },
        intervalWeeks: { type: Number, min: 1, max: 12, default: 4 },
        leadDays: { type: Number, min: 0, max: 14, default: 2 },
      },
      finalEvaluation: { enabled: { type: Boolean, default: true } },
    },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

TrainingPlanSchema.index({ athleteId: 1, status: 1, updatedAt: -1 });
TrainingPlanSchema.index({ coachId: 1, athleteId: 1, updatedAt: -1 });
TrainingPlanSchema.index(
  { athleteId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "one_active_plan_per_athlete",
  },
);

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
