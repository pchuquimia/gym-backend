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
    routineName: { type: String, default: '' },
    ownerId: { type: String, default: null },
    // se permiten campos adicionales (e.g. ejercicios) via strict: true por defecto, los que no esten en el schema seran ignorados
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.model('Training', TrainingSchema)
