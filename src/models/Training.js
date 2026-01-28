import mongoose from 'mongoose'

const EntrySchema = new mongoose.Schema(
  {
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
    done: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    previousText: { type: String, default: '' },
  },
  { _id: false },
)

const SetSchema = new mongoose.Schema(
  {
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
    done: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    seriesType: {
      type: String,
      enum: ['serie', 'biserie', 'triserie'],
      default: 'serie',
    },
    entries: [EntrySchema],
  },
  { _id: false },
)

const ExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, default: null },
    exerciseName: { type: String, default: '' },
    muscleGroup: { type: String, default: '' },
    order: { type: Number, default: 0 },
    seriesType: {
      type: String,
      enum: ['serie', 'biserie', 'triserie'],
      default: 'serie',
    },
    sets: [SetSchema],
  },
  { _id: false },
)

const TrainingSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(), // autogenerar si no se envia
    },
    date: { type: String, required: true }, // yyyy-mm-dd
    durationSeconds: { type: Number, default: 0 },
    totalVolume: { type: Number, default: 0 },
    routineId: { type: String, default: null },
    routineName: { type: String, default: '' },
    branch: { type: String, default: null },
    ownerId: { type: String, default: null },
    exercises: [ExerciseSchema],
  },
  { timestamps: true, versionKey: false },
)

TrainingSchema.index({ date: -1 })
TrainingSchema.index({ routineId: 1, date: -1 })
TrainingSchema.index({ branch: 1, date: -1 })
TrainingSchema.index({ 'exercises.exerciseId': 1, date: -1 })

export default mongoose.model('Training', TrainingSchema)
