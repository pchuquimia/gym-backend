import mongoose from "mongoose";

const PhotoAssetCleanupJobSchema = new mongoose.Schema(
  {
    publicId: { type: String, default: "" },
    deliveryType: {
      type: String,
      enum: ["upload", "authenticated"],
      default: "upload",
    },
    storage: {
      type: String,
      enum: ["cloudinary", "private-local", "legacy-local"],
      required: true,
    },
    localFilename: { type: String, default: "" },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true, versionKey: false },
);

PhotoAssetCleanupJobSchema.index({ createdAt: 1 });

export default mongoose.model(
  "PhotoAssetCleanupJob",
  PhotoAssetCleanupJobSchema,
);
