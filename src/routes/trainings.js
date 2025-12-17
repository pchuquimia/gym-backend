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
  const training = await Training.create(payload)
  res.status(201).json(training)
})

router.delete('/:id', async (req, res) => {
  await Training.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
