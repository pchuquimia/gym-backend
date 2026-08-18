import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const AthleteDailyMetricSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    dateKey: isoDateKey(),
    sessionCount: { type: Number, min: 0, default: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    totalVolume: { type: Number, min: 0, default: 0 },
    recordedSets: { type: Number, min: 0, default: 0 },
    completedSets: { type: Number, min: 0, default: 0 },
    exerciseCount: { type: Number, min: 0, default: 0 },
    muscleGroups: { type: [String], default: [] },
    readinessScore: { type: Number, min: 0, max: 100, default: null },
    readinessState: { type: String, default: "" },
    weightKg: { type: Number, default: null },
    sourceUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

AthleteDailyMetricSchema.index({ ownerId: 1, dateKey: 1 }, { unique: true });
AthleteDailyMetricSchema.index({ ownerId: 1, dateKey: -1 });

export default mongoose.model("AthleteDailyMetric", AthleteDailyMetricSchema);
