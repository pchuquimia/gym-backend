import { Router } from 'express'
import Preference from '../models/Preference.js'

const router = Router()

router.get('/', async (req, res) => {
  const userId = req.query.userId || 'default'
  const pref = await Preference.findOne({ userId }).lean()
  res.json(pref || { userId, branch: 'general' })
})

router.post('/', async (req, res) => {
  const userId = req.body.userId || 'default'
  const branch = req.body.branch || 'general'
  const pref = await Preference.findOneAndUpdate({ userId }, { branch }, { new: true, upsert: true, setDefaultsOnInsert: true })
  res.status(201).json(pref)
})

export default router
