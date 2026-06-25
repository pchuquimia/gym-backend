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
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("Routine", RoutineSchema);
