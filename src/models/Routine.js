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
    templateGroup: { type: String, default: "", index: true },
    goal: { type: String, default: "" },
    level: {
      type: String,
      enum: ["", "beginner", "intermediate", "advanced"],
      default: "",
    },
    tags: { type: [String], default: [] },
    branch: {
      type: String,
      enum: ["general", "sopocachi", "miraflores"],
      default: "sopocachi",
    },
    exerciseOrderMode: {
      type: String,
      enum: ["free", "muscle_blocks"],
      default: "free",
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
    visibility: {
      type: String,
      enum: ["system", "private"],
      default: "private",
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
RoutineSchema.index({ "exercises.exerciseId": 1 });
RoutineSchema.index({ "exercises.alternatives.exerciseId": 1 });
RoutineSchema.index({ ownerId: 1, progressScopeId: 1 });
RoutineSchema.index({ ownerId: 1, isArchived: 1, updatedAt: -1 });
RoutineSchema.index({ ownerId: 1, kind: 1, isArchived: 1 });
RoutineSchema.index({ visibility: 1, kind: 1, isArchived: 1 });
RoutineSchema.index({ visibility: 1, templateGroup: 1, level: 1 });

export default mongoose.model("Routine", RoutineSchema);
