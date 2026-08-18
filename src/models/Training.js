import mongoose from "mongoose";
import { isoDateKey, maxArrayLength } from "./schemaValidation.js";

const EntrySchema = new mongoose.Schema(
  {
    weightKg: { type: Number, min: 0, default: null },
    reps: { type: Number, min: 0, default: null },
    done: { type: Boolean, default: false },
    completedAt: { type: String, default: null },
    order: { type: Number, default: 0 },
    previousText: { type: String, default: "" },
  },
  { _id: false },
);

const SetSchema = new mongoose.Schema(
  {
    weightKg: { type: Number, min: 0, default: null },
    reps: { type: Number, min: 0, default: null },
    done: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    seriesType: {
      type: String,
      enum: ["serie", "biserie", "triserie"],
      default: "serie",
    },
    entries: [EntrySchema],
  },
  { _id: false },
);

const ExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, default: null },
    exerciseName: { type: String, default: "" },
    muscleGroup: { type: String, default: "" },
    primaryMuscleGroup: { type: String, default: "" },
    primaryMuscles: { type: [String], default: [] },
    secondaryMuscles: { type: [String], default: [] },
    stabilizerMuscles: { type: [String], default: [] },
    equipment: { type: [String], default: [] },
    loadType: {
      type: String,
      enum: [
        "",
        "external",
        "machine",
        "bodyweight",
        "assisted",
        "cardio",
        "unknown",
      ],
      default: "",
    },
    weightBasis: {
      type: String,
      enum: [
        "legacy",
        "total",
        "per_side",
        "per_implement",
        "machine",
        "additional",
        "assistance",
      ],
      default: "legacy",
    },
    barWeightKg: { type: Number, min: 0, default: 0 },
    implementCount: { type: Number, min: 1, max: 4, default: 1 },
    order: { type: Number, default: 0 },
    plannedOrder: { type: Number, default: 0 },
    actualOrder: { type: Number, default: 0 },
    orderContext: {
      type: String,
      enum: ["normal", "first", "early", "fatigued", "extra"],
      default: "normal",
    },
    movementMode: {
      type: String,
      enum: ["bilateral", "unilateral"],
      default: "bilateral",
    },
    seriesType: {
      type: String,
      enum: ["serie", "biserie", "triserie"],
      default: "serie",
    },
    setupNote: { type: String, trim: true, maxlength: 240, default: "" },
    sets: [SetSchema],
  },
  { _id: false },
);

const TimeEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "session_start",
        "session_pause",
        "session_resume",
        "session_end",
        "exercise_start",
        "rest_start",
        "rest_end",
      ],
      required: true,
    },
    at: { type: String, required: true },
    exerciseId: { type: String, default: null },
  },
  { _id: false },
);

const ExerciseDurationSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    durationSeconds: { type: Number, default: 0 },
    workSeconds: { type: Number, default: null },
    restSeconds: { type: Number, default: null },
    durationOverrideSeconds: { type: Number, default: null },
  },
  { _id: false },
);

const TrainingSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(), // autogenerar si no se envia
    },
    date: isoDateKey(),
    durationSeconds: { type: Number, min: 0, max: 86400, default: 0 },
    durationOverrideSeconds: { type: Number, min: 0, max: 86400, default: null },
    workSeconds: { type: Number, min: 0, default: null },
    restSeconds: { type: Number, min: 0, default: null },
    pauseSeconds: { type: Number, min: 0, default: null },
    timeEvents: {
      type: [TimeEventSchema],
      validate: maxArrayLength(1000, "El historial de tiempos"),
    },
    exerciseDurations: [ExerciseDurationSchema],
    totalVolume: { type: Number, min: 0, default: 0 },
    volumeBreakdown: {
      recordedSets: { type: Number, default: 0 },
      completedSets: { type: Number, default: 0 },
      incompleteSets: { type: Number, default: 0 },
      externalKg: { type: Number, default: 0 },
      machineKg: { type: Number, default: 0 },
      unknownKg: { type: Number, default: 0 },
      assistanceKg: { type: Number, default: 0 },
      bodyweightSets: { type: Number, default: 0 },
      assistedSets: { type: Number, default: 0 },
      machineSets: { type: Number, default: 0 },
      cardioSets: { type: Number, default: 0 },
      unknownSets: { type: Number, default: 0 },
    },
    routineId: { type: String, default: null },
    routineName: { type: String, default: "" },
    registrationKey: { type: String, default: undefined },
    trainingPlanId: { type: String, default: null, index: true },
    trainingPlanSlotId: { type: String, default: null, index: true },
    scheduleOverride: {
      acknowledged: { type: Boolean, default: false },
      scheduledDate: { type: String, default: "" },
      actualDate: { type: String, default: "" },
      selectedDayIndex: { type: Number, default: null },
      scheduleMode: { type: String, default: "" },
      acknowledgedAt: { type: String, default: "" },
    },
    progressScopeId: { type: String, default: "" },
    orderSignature: { type: String, default: "" },
    branch: { type: String, default: null },
    ownerId: { type: String, required: true },
    historicalRefs: {
      routineId: { type: String, default: null },
      trainingPlanId: { type: String, default: null },
      detachedAt: { type: Date, default: null },
      reason: { type: String, default: "" },
    },
    sessionType: {
      type: String,
      enum: ["personal", "supervised"],
      default: "personal",
    },
    startedBy: { type: String, default: null },
    supervisedBy: { type: String, default: null, index: true },
    exercises: {
      type: [ExerciseSchema],
      validate: maxArrayLength(100, "La lista de ejercicios"),
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

TrainingSchema.index({ date: -1 });
TrainingSchema.index({ ownerId: 1, date: -1 });
TrainingSchema.index({ ownerId: 1, date: -1, _id: -1 });
TrainingSchema.index(
  { registrationKey: 1 },
  { unique: true, sparse: true, name: "unique_training_registration" },
);
TrainingSchema.index({ routineId: 1, date: -1 });
TrainingSchema.index({ trainingPlanId: 1, trainingPlanSlotId: 1, date: -1 });
TrainingSchema.index({ ownerId: 1, trainingPlanId: 1, date: -1 });
TrainingSchema.index({ progressScopeId: 1, date: -1 });
TrainingSchema.index({ progressScopeId: 1, orderSignature: 1, date: -1 });
TrainingSchema.index({ branch: 1, date: -1 });
TrainingSchema.index({ "exercises.exerciseId": 1, date: -1 });
TrainingSchema.index({ "timeEvents.exerciseId": 1 });
TrainingSchema.index({ "exerciseDurations.exerciseId": 1 });

export default mongoose.model("Training", TrainingSchema);
