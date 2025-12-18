import mongoose from 'mongoose'

const PreferenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    branch: { type: String, enum: ['sopocachi', 'miraflores', 'general'], default: 'general' },
    goals: { type: Object, default: {} },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Preference', PreferenceSchema)
