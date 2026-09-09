import mongoose from "mongoose";

const CoachInvitationSchema = new mongoose.Schema(
  {
    coachId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    acceptedById: { type: String, default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

CoachInvitationSchema.index({ coachId: 1, status: 1, createdAt: -1 });

export default mongoose.model("CoachInvitation", CoachInvitationSchema);
