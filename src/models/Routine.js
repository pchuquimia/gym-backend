import mongoose from 'mongoose'

const RoutineExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    name: { type: String, required: true },
    sets: { type: Number, default: 3 },
  },
  { _id: false },
)

const RoutineSchema = new mongoose.Schema(
  {
    _id: { type: String }, // slug/id string
    name: { type: String, required: true },
    description: { type: String, default: '' },
    exercises: [RoutineExerciseSchema],
    ownerId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Routine', RoutineSchema)
