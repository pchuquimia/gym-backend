import mongoose from "mongoose";

const CatalogExerciseStateSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    isActive: { type: Boolean, required: true },
  },
  { _id: false },
);

const CatalogSwitchStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    sourceProvider: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "restored"],
      default: "active",
    },
    previousExercises: { type: [CatalogExerciseStateSchema], default: [] },
    activatedAt: { type: Date, default: Date.now },
    restoredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("CatalogSwitchState", CatalogSwitchStateSchema);
