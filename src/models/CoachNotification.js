import mongoose from "mongoose";

const CoachNotificationSchema = new mongoose.Schema(
  {
    coachId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "athlete_account_deleted",
        "athlete_joined",
        "intake_submitted",
        "critical_check_in",
        "final_assessment_submitted",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    athleteId: { type: String, default: null, index: true },
    entityId: { type: String, default: null },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

CoachNotificationSchema.index({ coachId: 1, createdAt: -1 });

export default mongoose.model("CoachNotification", CoachNotificationSchema);
