import mongoose from "mongoose";

const TRAINING_DRAFT_TTL_DAYS = 14;

const TrainingDraftSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    startedById: { type: String, required: true, index: true },
    trainingRequestId: { type: String, required: true, trim: true },
    routineId: { type: String, required: true, trim: true },
    sessionDate: { type: String, default: "" },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: {
      type: Date,
      default: () =>
        new Date(Date.now() + TRAINING_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

TrainingDraftSchema.index(
  { ownerId: 1, startedById: 1 },
  { unique: true, name: "active_training_draft_by_actor" },
);

export default mongoose.model("TrainingDraft", TrainingDraftSchema);
