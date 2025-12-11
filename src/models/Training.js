import mongoose from 'mongoose'

const TrainingSchema = new mongoose.Schema(
  {
    _id: { type: String }, // trainingId
    date: { type: String, required: true }, // yyyy-mm-dd
    durationSeconds: { type: Number, default: 0 },
    totalVolume: { type: Number, default: 0 },
    routineName: { type: String, default: '' },
    ownerId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Training', TrainingSchema)
