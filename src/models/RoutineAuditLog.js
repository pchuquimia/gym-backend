import mongoose from "mongoose";

const RoutineAuditLogSchema = new mongoose.Schema(
  {
    routineId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    actorId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ["archived", "restored"],
      required: true,
    },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, versionKey: false },
);

RoutineAuditLogSchema.index({ routineId: 1, createdAt: -1 });
RoutineAuditLogSchema.index({ ownerId: 1, createdAt: -1 });

export default mongoose.model("RoutineAuditLog", RoutineAuditLogSchema);
