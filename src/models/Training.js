import mongoose from "mongoose";

const EntrySchema = new mongoose.Schema(
  {
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
    done: { type: Boolean, default: false },
    completedAt: { type: String, default: null },
    order: { type: Number, default: 0 },
    previousText: { type: String, default: "" },
  },
  { _id: false },
);

const SetSchema = new mongoose.Schema(
  {
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
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
    date: { type: String, required: true }, // yyyy-mm-dd
    durationSeconds: { type: Number, default: 0 },
    timeEvents: [TimeEventSchema],
    exerciseDurations: [ExerciseDurationSchema],
    totalVolume: { type: Number, default: 0 },
    routineId: { type: String, default: null },
    routineName: { type: String, default: "" },
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
    ownerId: { type: String, default: null },
    sessionType: {
      type: String,
      enum: ["personal", "supervised"],
      default: "personal",
    },
    startedBy: { type: String, default: null },
    supervisedBy: { type: String, default: null, index: true },
    exercises: [ExerciseSchema],
  },
  { timestamps: true, versionKey: false },
);

TrainingSchema.index({ date: -1 });
TrainingSchema.index({ ownerId: 1, date: -1 });
TrainingSchema.index({ routineId: 1, date: -1 });
TrainingSchema.index({ trainingPlanId: 1, trainingPlanSlotId: 1, date: -1 });
TrainingSchema.index({ progressScopeId: 1, date: -1 });
TrainingSchema.index({ progressScopeId: 1, orderSignature: 1, date: -1 });
TrainingSchema.index({ branch: 1, date: -1 });
TrainingSchema.index({ "exercises.exerciseId": 1, date: -1 });
TrainingSchema.index({ "timeEvents.exerciseId": 1 });
TrainingSchema.index({ "exerciseDurations.exerciseId": 1 });

export default mongoose.model("Training", TrainingSchema);
