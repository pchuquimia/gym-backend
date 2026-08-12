import mongoose from "mongoose";

const MediaAssetSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    format: { type: String, default: "" },
    bytes: { type: Number, default: null },
    version: { type: Number, default: null },
  },
  { _id: false },
);

const ExerciseSourceSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true },
    externalId: { type: String, required: true, trim: true },
    mediaId: { type: String, default: "" },
    datasetCommit: { type: String, default: "" },
    imagePath: { type: String, default: "" },
    animationPath: { type: String, default: "" },
    attribution: { type: String, default: "" },
    importedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
  },
  { _id: false },
);

const WeightConfigSchema = new mongoose.Schema(
  {
    basis: {
      type: String,
      enum: [
        "total",
        "per_side",
        "per_implement",
        "machine",
        "additional",
        "assistance",
      ],
      required: true,
    },
    barWeightKg: { type: Number, min: 0, default: 0 },
    implementCount: { type: Number, min: 1, max: 4, default: 1 },
  },
  { _id: false },
);

const ExerciseSchema = new mongoose.Schema(
  {
    _id: { type: String }, // usamos slug/id string para alinear con frontend
    name: { type: String, required: true, trim: true },
    localizedNames: {
      es: { type: String, default: "", trim: true },
      en: { type: String, default: "", trim: true },
    },
    slug: { type: String, default: "" },
    aliases: { type: [String], default: [] },
    category: { type: String, default: "" },
    categories: { type: [String], default: [] },
    bodyRegion: { type: String, default: "" },
    navigationRegion: { type: String, default: "" },
    primaryMuscleGroup: { type: String, default: "" },
    muscle: { type: String, default: "" },
    primaryMuscle: { type: String, default: "" },
    primaryMuscles: { type: [String], default: [] },
    secondaryMuscles: { type: [String], default: [] },
    stabilizerMuscles: { type: [String], default: [] },
    description: { type: String, default: "" },
    instructions: { type: [String], default: [] },
    commonMistakes: { type: [String], default: [] },
    movementPattern: { type: String, default: "" },
    movementPatterns: { type: [String], default: [] },
    equipment: { type: [String], default: [] },
    loadType: {
      type: String,
      enum: ["", "external", "machine", "bodyweight", "assisted", "cardio", "unknown"],
      default: "",
    },
    weightConfig: { type: WeightConfigSchema, default: undefined },
    exerciseType: { type: String, default: "" },
    laterality: { type: String, default: "" },
    kineticChain: { type: String, default: "" },
    executionType: { type: String, default: "" },
    stability: { type: String, default: "" },
    position: { type: String, default: "" },
    difficulty: { type: String, default: "" },
    goals: { type: [String], default: [] },
    mechanics: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ forceType: "", contraction: "" }),
    },
    force: {
      type: String,
      enum: ["", "push", "pull", "legs", "core"],
      default: "",
    },
    precautions: { type: [String], default: [] },
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
      animation: { type: MediaAssetSchema, default: () => ({}) },
      video: { type: MediaAssetSchema, default: () => ({}) },
    },
    alternateMedia: [
      {
        sourceExerciseId: { type: String, required: true },
        label: { type: String, default: "" },
        image: { type: MediaAssetSchema, default: () => ({}) },
        animation: { type: MediaAssetSchema, default: () => ({}) },
        _id: false,
      },
    ],
    source: { type: ExerciseSourceSchema, default: undefined },
    classificationStatus: {
      type: String,
      enum: [
        "imported",
        "partially_mapped",
        "mapped",
        "review",
        "reviewed",
        "curated",
      ],
      default: "curated",
    },
    taxonomyVersion: { type: Number, default: 1 },
    identityKey: { type: String, default: "", trim: true },
    mergedIntoExerciseId: { type: String, default: null },
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
ExerciseSchema.index({ "localizedNames.es": 1 });
ExerciseSchema.index({ "localizedNames.en": 1 });
ExerciseSchema.index({ muscle: 1 });
ExerciseSchema.index({ slug: 1 });
ExerciseSchema.index({ identityKey: 1, isActive: 1 });
ExerciseSchema.index({ type: 1, ownerId: 1, isActive: 1 });
ExerciseSchema.index({ primaryMuscle: 1 });
ExerciseSchema.index({ primaryMuscleGroup: 1 });
ExerciseSchema.index({ bodyRegion: 1 });
ExerciseSchema.index({ navigationRegion: 1 });
ExerciseSchema.index({ categories: 1 });
ExerciseSchema.index({ movementPatterns: 1 });
ExerciseSchema.index({ equipment: 1 });
ExerciseSchema.index({ difficulty: 1 });
ExerciseSchema.index({ goals: 1 });
ExerciseSchema.index({ tags: 1 });
ExerciseSchema.index(
  { "source.provider": 1, "source.externalId": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "source.provider": { $type: "string" },
      "source.externalId": { $type: "string" },
    },
  },
);

export default mongoose.model("Exercise", ExerciseSchema);
