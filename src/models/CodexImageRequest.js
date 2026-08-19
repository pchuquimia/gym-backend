import mongoose from "mongoose";

const CodexImageRequestSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true, index: true, trim: true },
    exerciseName: { type: String, required: true, trim: true },
    referenceImage: { type: String, required: true, trim: true },
    instruction: { type: String, default: "", maxlength: 2000, trim: true },
    prompt: { type: String, required: true, maxlength: 32000 },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "ready",
        "failed",
        "applied",
        "cancelled",
        "rejected",
        "skipped",
      ],
      default: "pending",
      required: true,
      index: true,
    },
    requestedBy: { type: String, required: true, index: true },
    source: {
      type: String,
      enum: ["manual", "automatic", "regeneration"],
      default: "manual",
      index: true,
    },
    attempt: { type: Number, default: 1, min: 1 },
    parentRequestId: { type: String, default: "", trim: true },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    appliedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "", trim: true },
    reviewDecision: {
      type: String,
      enum: ["", "approved", "regenerate", "skipped"],
      default: "",
    },
    reviewReason: { type: String, default: "", maxlength: 2000, trim: true },
    error: { type: String, default: "", maxlength: 2000 },
    result: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      storage: {
        type: String,
        enum: ["", "local", "cloudinary"],
        default: "",
      },
      filename: { type: String, default: "" },
      bytes: { type: Number, default: 0, min: 0 },
      width: { type: Number, default: 0, min: 0 },
      height: { type: Number, default: 0, min: 0 },
      format: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_document, value) => {
        value.id = String(value._id);
        delete value._id;
        return value;
      },
    },
  },
);

CodexImageRequestSchema.index({ status: 1, createdAt: 1 });
CodexImageRequestSchema.index({ status: 1, completedAt: 1 });
CodexImageRequestSchema.index({ exerciseId: 1, createdAt: -1 });

export default mongoose.model("CodexImageRequest", CodexImageRequestSchema);
