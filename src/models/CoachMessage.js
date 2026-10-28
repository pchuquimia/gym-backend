import mongoose from "mongoose";

const CoachMessageSchema = new mongoose.Schema(
  {
    coachId: { type: String, required: true },
    athleteId: { type: String, required: true },
    senderId: { type: String, required: true },
    recipientId: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    clientMessageId: { type: String, required: true, maxlength: 80 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
CoachMessageSchema.index({ coachId: 1, athleteId: 1, _id: -1 });
CoachMessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
CoachMessageSchema.index({ recipientId: 1, readAt: 1, senderId: 1 });
export default mongoose.model("CoachMessage", CoachMessageSchema);
