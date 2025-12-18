import { Router } from 'express'
import Preference from '../models/Preference.js'

const router = Router()

router.get('/', async (req, res) => {
  const userId = req.query.userId || 'default'
  const pref = await Preference.findOne({ userId }).lean()
  res.json(pref || { userId, branch: 'general', goals: {} })
})

router.post('/', async (req, res) => {
  const userId = req.body.userId || 'default'
  const update = {}
  if (req.body.branch) update.branch = req.body.branch
  if (req.body.goals) update.goals = req.body.goals
  if (!update.branch) update.branch = 'general'

  const pref = await Preference.findOneAndUpdate(
    { userId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  res.status(201).json(pref)
})

export default router
