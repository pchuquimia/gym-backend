import mongoose from "mongoose";

const SetSchema = new mongoose.Schema(
  {
    reps: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    note: { type: String, default: "" },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const SessionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // yyyy-mm-dd
    trainingId: { type: String, default: null },
    exerciseId: { type: String, required: true },
    exerciseName: { type: String, required: true },
    movementMode: {
      type: String,
      enum: ["bilateral", "unilateral"],
      default: "bilateral",
    },
    weightBasis: {
      type: String,
      enum: [
        "legacy",
        "total",
        "per_side",
        "per_implement",
        "machine",
        "additional",
        "assistance",
      ],
      default: "legacy",
    },
    barWeightKg: { type: Number, min: 0, default: 0 },
    implementCount: { type: Number, min: 1, max: 4, default: 1 },
    routineId: { type: String, default: null },
    routineName: { type: String, default: "" },
    sets: [SetSchema],
    trainingDurationSeconds: { type: Number, default: 0 },
    exerciseDurationSeconds: { type: Number, default: 0 },
    photoUrl: { type: String, default: "" },
    photoType: { type: String, enum: ["gym", "home", ""], default: "" },
    ownerId: { type: String, default: null },
    sessionType: {
      type: String,
      enum: ["personal", "supervised"],
      default: "personal",
    },
    startedBy: { type: String, default: null },
    supervisedBy: { type: String, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

SessionSchema.index({ exerciseId: 1, date: -1 });
SessionSchema.index({ routineId: 1, date: -1 });
SessionSchema.index({ date: -1 });

export default mongoose.model("Session", SessionSchema);
