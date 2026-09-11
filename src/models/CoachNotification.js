import mongoose from "mongoose";

const CoachNotificationSchema = new mongoose.Schema(
  {
    coachId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["athlete_account_deleted"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

CoachNotificationSchema.index({ coachId: 1, createdAt: -1 });

export default mongoose.model("CoachNotification", CoachNotificationSchema);
