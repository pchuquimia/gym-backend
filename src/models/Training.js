import mongoose from 'mongoose'

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
    exercises: [
      {
        exerciseId: { type: String, default: null },
        exerciseName: { type: String, default: '' },
        muscleGroup: { type: String, default: '' },
        order: { type: Number, default: 0 },
        sets: [
          {
            weightKg: { type: Number, default: null },
            reps: { type: Number, default: null },
            done: { type: Boolean, default: false },
            order: { type: Number, default: 0 },
          },
        ],
      },
    ],
  },
  { timestamps: true, versionKey: false },
)

TrainingSchema.index({ date: -1 })
TrainingSchema.index({ routineId: 1, date: -1 })
TrainingSchema.index({ branch: 1, date: -1 })
TrainingSchema.index({ 'exercises.exerciseId': 1, date: -1 })

export default mongoose.model('Training', TrainingSchema)
