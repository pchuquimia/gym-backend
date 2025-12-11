import { Router } from 'express'
import Exercise from '../models/Exercise.js'

const router = Router()

router.get('/', async (req, res) => {
  const exercises = await Exercise.find().lean()
  res.json(exercises)
})

router.post('/', async (req, res) => {
  const exercise = await Exercise.create(req.body)
  res.status(201).json(exercise)
})

router.put('/:id', async (req, res) => {
  const exercise = await Exercise.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(exercise)
})

router.delete('/:id', async (req, res) => {
  await Exercise.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
