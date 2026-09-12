import mongoose from "mongoose";

const UserNotificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["plan_activated", "plan_scheduled"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    entityId: { type: String, default: null },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

UserNotificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("UserNotification", UserNotificationSchema);
