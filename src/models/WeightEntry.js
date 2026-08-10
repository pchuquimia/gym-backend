import mongoose from "mongoose";

const WeightEntrySchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true },
    weightKg: { type: Number, required: true, min: 25, max: 400 },
    note: { type: String, default: "", trim: true, maxlength: 160 },
    recordedBy: { type: String, required: true },
    source: {
      type: String,
      enum: ["self", "coach"],
      default: "self",
    },
  },
  { timestamps: true, versionKey: false },
);

WeightEntrySchema.index({ ownerId: 1, dateKey: 1 }, { unique: true });
WeightEntrySchema.index({ ownerId: 1, dateKey: -1 });

export default mongoose.model("WeightEntry", WeightEntrySchema);
