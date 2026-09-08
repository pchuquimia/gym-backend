import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const HydrationEntrySchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    dateKey: isoDateKey(),
    amountMl: { type: Number, required: true, min: 50, max: 6000 },
    recordedBy: { type: String, required: true },
    source: {
      type: String,
      enum: ["self", "coach"],
      default: "self",
    },
  },
  { timestamps: true, versionKey: false },
);

HydrationEntrySchema.index({ ownerId: 1, dateKey: 1, createdAt: -1 });

export default mongoose.model("HydrationEntry", HydrationEntrySchema);
