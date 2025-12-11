import { Router } from 'express'
import Session from '../models/Session.js'

const router = Router()

router.get('/', async (_req, res) => {
  const sessions = await Session.find().lean()
  res.json(sessions)
})

router.post('/', async (req, res) => {
  const session = await Session.create(req.body)
  res.status(201).json(session)
})

router.delete('/:id', async (req, res) => {
  await Session.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
