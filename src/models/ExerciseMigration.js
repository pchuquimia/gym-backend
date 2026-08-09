import mongoose from "mongoose";

const ExerciseMigrationSchema = new mongoose.Schema(
  {
    operation: {
      type: String,
      enum: ["migrate", "delete"],
      required: true,
    },
    sourceExercise: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    targetExercise: {
      id: { type: String, default: "" },
      name: { type: String, default: "" },
    },
    references: {
      routines: { type: Number, default: 0 },
      trainings: { type: Number, default: 0 },
      sessions: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    sourceDeleted: { type: Boolean, default: false },
    performedBy: { type: String, required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

ExerciseMigrationSchema.index({ createdAt: -1 });
ExerciseMigrationSchema.index({ "sourceExercise.id": 1, createdAt: -1 });

export default mongoose.model("ExerciseMigration", ExerciseMigrationSchema);
