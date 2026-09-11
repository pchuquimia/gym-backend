import mongoose from "mongoose";
import {
  DEFAULT_FOLLOW_UP,
  DEFAULT_INTAKE_QUESTIONS,
  QUESTION_TYPES,
} from "../utils/coachWorkflow.js";

const IntakeQuestionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 50 },
    label: { type: String, required: true, trim: true, maxlength: 180 },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    required: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    options: { type: [String], default: [] },
    detailPrompt: { type: String, trim: true, maxlength: 180, default: "" },
    detailRequired: { type: Boolean, default: false },
  },
  { _id: false },
);

const FollowUpSchema = new mongoose.Schema(
  {
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
  { _id: false },
);

const CoachWorkflowSettingsSchema = new mongoose.Schema(
  {
    coachId: { type: String, required: true, unique: true, index: true },
    intakeQuestions: {
      type: [IntakeQuestionSchema],
      default: () =>
        DEFAULT_INTAKE_QUESTIONS.map((question) => ({ ...question })),
    },
    followUp: {
      type: FollowUpSchema,
      default: () => ({ ...DEFAULT_FOLLOW_UP }),
    },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model(
  "CoachWorkflowSettings",
  CoachWorkflowSettingsSchema,
);
