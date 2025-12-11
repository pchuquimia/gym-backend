import mongoose from 'mongoose'

const PhotoSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // yyyy-mm-dd
    label: { type: String, default: '' },
    url: { type: String, required: true },
    type: { type: String, enum: ['gym', 'home'], default: 'gym' },
    sessionId: { type: String, default: null },
    ownerId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Photo', PhotoSchema)
