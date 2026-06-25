import mongoose from "mongoose";

const MediaAssetSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    format: { type: String, default: "" },
    bytes: { type: Number, default: null },
  },
  { _id: false },
);

const ExerciseSchema = new mongoose.Schema(
  {
    _id: { type: String }, // usamos slug/id string para alinear con frontend
    name: { type: String, required: true, trim: true },
    slug: { type: String, default: "" },
    muscle: { type: String, default: "" },
    primaryMuscle: { type: String, default: "" },
    secondaryMuscles: { type: [String], default: [] },
    description: { type: String, default: "" },
    instructions: { type: [String], default: [] },
    commonMistakes: { type: [String], default: [] },
    equipment: { type: String, default: "" },
    mechanics: {
      type: String,
      enum: ["", "compound", "isolation"],
      default: "",
    },
    force: {
      type: String,
      enum: ["", "push", "pull", "legs", "core"],
      default: "",
    },
    movementMode: {
      type: String,
      enum: ["bilateral", "unilateral"],
      default: "bilateral",
    },
    supportsUnilateral: { type: Boolean, default: false },
    image: { type: String, default: "" },
    thumb: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    media: {
      image: { type: MediaAssetSchema, default: () => ({}) },
      thumbnail: { type: MediaAssetSchema, default: () => ({}) },
      video: { type: MediaAssetSchema, default: () => ({}) },
    },
    branches: { type: [String], default: ["general"] },
    tags: { type: [String], default: [] },
    type: { type: String, enum: ["system", "custom"], default: "custom" },
    ownerId: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

ExerciseSchema.index({ name: 1 });
ExerciseSchema.index({ muscle: 1 });
ExerciseSchema.index({ slug: 1 });
ExerciseSchema.index({ type: 1, ownerId: 1, isActive: 1 });
ExerciseSchema.index({ primaryMuscle: 1 });
ExerciseSchema.index({ tags: 1 });

export default mongoose.model("Exercise", ExerciseSchema);
