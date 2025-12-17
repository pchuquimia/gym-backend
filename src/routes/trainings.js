import { Router } from 'express'
import Training from '../models/Training.js'

const router = Router()

router.get('/', async (_req, res) => {
  const trainings = await Training.find().lean()
  res.json(trainings)
})

router.post('/', async (req, res) => {
  const payload = { ...req.body }
  // si viene id, usarlo como _id; si no, dejar que el schema genere uno
  if (payload.id) payload._id = payload.id
  delete payload.id
  // calcular volumen total si vienen sets
  const totalVolume =
    Array.isArray(payload.exercises) &&
    payload.exercises.reduce((acc, ex) => {
      const sets = Array.isArray(ex.sets) ? ex.sets : []
      const vol = sets.reduce((s, set) => {
        const w = Number(set.weightKg || 0)
        const r = Number(set.reps || 0)
        return s + w * r
      }, 0)
      return acc + vol
    }, 0)
  payload.totalVolume = Number.isFinite(totalVolume) ? totalVolume : 0

  const training = await Training.create(payload)
  res.status(201).json(training)
})

router.delete('/:id', async (req, res) => {
  await Training.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
