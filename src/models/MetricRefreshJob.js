import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const MetricRefreshJobSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true },
    dateKey: isoDateKey(),
    status: {
      type: String,
      enum: ["pending", "running", "complete", "failed"],
      default: "pending",
    },
    attempts: { type: Number, min: 0, default: 0 },
    nextRunAt: { type: Date, default: Date.now },
    lockedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

MetricRefreshJobSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 });
MetricRefreshJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("MetricRefreshJob", MetricRefreshJobSchema);
