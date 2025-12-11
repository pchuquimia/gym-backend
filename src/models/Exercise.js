import mongoose from 'mongoose'

const ExerciseSchema = new mongoose.Schema(
  {
    _id: { type: String }, // usamos slug/id string para alinear con frontend
    name: { type: String, required: true, trim: true },
    muscle: { type: String, default: '' },
    description: { type: String, default: '' },
    equipment: { type: String, default: '' },
    image: { type: String, default: '' },
    type: { type: String, enum: ['system', 'custom'], default: 'custom' },
    ownerId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Exercise', ExerciseSchema)
