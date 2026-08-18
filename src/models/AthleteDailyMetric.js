import mongoose from "mongoose";

const AthleteDailyMetricSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    dateKey: { type: String, required: true },
    sessionCount: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    totalVolume: { type: Number, default: 0 },
    recordedSets: { type: Number, default: 0 },
    completedSets: { type: Number, default: 0 },
    exerciseCount: { type: Number, default: 0 },
    muscleGroups: { type: [String], default: [] },
    readinessScore: { type: Number, default: null },
    readinessState: { type: String, default: "" },
    weightKg: { type: Number, default: null },
    sourceUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

AthleteDailyMetricSchema.index({ ownerId: 1, dateKey: 1 }, { unique: true });
AthleteDailyMetricSchema.index({ ownerId: 1, dateKey: -1 });

export default mongoose.model("AthleteDailyMetric", AthleteDailyMetricSchema);
