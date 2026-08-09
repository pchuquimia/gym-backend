import mongoose from "mongoose";

const RoutineExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    name: { type: String, required: true },
    sets: { type: Number, default: 3 },
    supportsUnilateral: { type: Boolean, default: false },
    movementMode: {
      type: String,
      enum: ["bilateral", "unilateral"],
      default: "bilateral",
    },
    isExtra: { type: Boolean, default: false },
    muscle: { type: String, default: "" },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    alternatives: [
      {
        exerciseId: { type: String, required: true },
        name: { type: String, required: true },
        muscle: { type: String, default: "" },
        image: { type: String, default: "" },
        imagePublicId: { type: String, default: "" },
        supportsUnilateral: { type: Boolean, default: false },
        movementMode: {
          type: String,
          enum: ["bilateral", "unilateral"],
          default: "bilateral",
        },
      },
    ],
  },
  { _id: false },
);

const RoutineSchema = new mongoose.Schema(
  {
    _id: { type: String }, // slug/id string
    name: { type: String, required: true },
    description: { type: String, default: "" },
    branch: {
      type: String,
      enum: ["sopocachi", "miraflores"],
      default: "sopocachi",
    },
    exercises: [RoutineExerciseSchema],
    ownerId: { type: String, default: null },
    progressScopeId: { type: String, default: "" },
    progressMode: {
      type: String,
      enum: ["fresh", "inherit"],
      default: "fresh",
    },
    sourceRoutineId: { type: String, default: null },
    sourceRoutineVersion: { type: Number, min: 1, default: null },
    kind: {
      type: String,
      enum: ["template", "personal", "assigned"],
      default: "personal",
      index: true,
    },
    version: { type: Number, min: 1, default: 1 },
    assignedByCoachId: { type: String, default: null, index: true },
    assignedAt: { type: Date, default: null },
    trainingPlanId: { type: String, default: null, index: true },
    trainingPlanSlotId: { type: String, default: null, index: true },
    assignmentType: {
      type: String,
      enum: ["personal", "plan", "extra"],
      default: "personal",
    },
    isArchived: { type: Boolean, default: false, index: true },
    isAvailableForTraining: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

RoutineSchema.index({ progressScopeId: 1 });
RoutineSchema.index({ ownerId: 1, progressScopeId: 1 });
RoutineSchema.index({ ownerId: 1, isArchived: 1, updatedAt: -1 });
RoutineSchema.index({ ownerId: 1, kind: 1, isArchived: 1 });

export default mongoose.model("Routine", RoutineSchema);
