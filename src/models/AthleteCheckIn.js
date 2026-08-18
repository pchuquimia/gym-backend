import mongoose from "mongoose";

const AthleteCheckInSchema = new mongoose.Schema(
  {
    athleteId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true },
    sleep: { type: Number, required: true, min: 1, max: 5 },
    energy: { type: Number, required: true, min: 1, max: 5 },
    stress: { type: Number, required: true, min: 1, max: 5 },
    soreness: { type: Number, required: true, min: 1, max: 5 },
    motivation: { type: Number, required: true, min: 1, max: 5 },
    jointPain: { type: Number, required: true, min: 1, max: 5 },
    painAreas: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    readinessScore: { type: Number, min: 0, max: 100, required: true },
    readinessState: {
      type: String,
      enum: ["ready", "adjust", "recover"],
      required: true,
    },
    submittedBy: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

AthleteCheckInSchema.index({ athleteId: 1, dateKey: 1 }, { unique: true });
AthleteCheckInSchema.index({ athleteId: 1, dateKey: -1 });

export default mongoose.model("AthleteCheckIn", AthleteCheckInSchema);
