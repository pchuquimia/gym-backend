import { Router } from 'express'
import Training from '../models/Training.js'

const router = Router()

router.get('/', async (_req, res) => {
  const trainings = await Training.find().lean()
  res.json(trainings)
})

router.post('/', async (req, res) => {
  const training = await Training.create({ ...req.body, _id: req.body.id || req.body._id })
  res.status(201).json(training)
})

router.delete('/:id', async (req, res) => {
  await Training.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
