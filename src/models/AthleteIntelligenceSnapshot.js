import mongoose from "mongoose";

const AthleteIntelligenceSnapshotSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    dateKey: { type: String, required: true },
    variant: {
      type: String,
      enum: ["basic", "advanced"],
      required: true,
    },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    dirty: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

AthleteIntelligenceSnapshotSchema.index(
  { ownerId: 1, dateKey: 1, variant: 1 },
  { unique: true },
);
AthleteIntelligenceSnapshotSchema.index({ ownerId: 1, dirty: 1 });

export default mongoose.model(
  "AthleteIntelligenceSnapshot",
  AthleteIntelligenceSnapshotSchema,
);
