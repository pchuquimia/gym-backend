import { Router } from 'express'
import Routine from '../models/Routine.js'

const router = Router()

router.get('/', async (_req, res) => {
  const routines = await Routine.find().lean()
  res.json(routines)
})

router.post('/', async (req, res) => {
  const routine = await Routine.create(req.body)
  res.status(201).json(routine)
})

router.put('/:id', async (req, res) => {
  const routine = await Routine.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(routine)
})

router.delete('/:id', async (req, res) => {
  await Routine.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
