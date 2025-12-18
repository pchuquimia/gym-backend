import { Router } from 'express'
import Exercise from '../models/Exercise.js'

const router = Router()

router.get('/:id', async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id).lean()
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' })
    res.json(exercise)
  } catch (err) {
    next(err)
  }
})

// GET /api/exercises?page=1&limit=100&fields=name,muscle,image,branches
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
    const fields = req.query.fields
      ? req.query.fields.split(',').join(' ')
      : 'name muscle branches type thumb updatedAt createdAt' // excluimos image/description por defecto para reducir payload

    const exercises = await Exercise.find({}, fields)
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean()

    const includeMeta = req.query.meta === 'true'
    res.set('Cache-Control', 'public, max-age=300')
    if (includeMeta) {
      res.json({ page, limit, count: exercises.length, items: exercises })
    } else {
      res.json(exercises)
    }
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res) => {
  const branches = Array.isArray(req.body.branches) && req.body.branches.length ? req.body.branches : ['general']
  const exercise = await Exercise.create({ ...req.body, branches })
  res.status(201).json(exercise)
})

router.put('/:id', async (req, res) => {
  const branches = Array.isArray(req.body.branches) && req.body.branches.length ? req.body.branches : ['general']
  const exercise = await Exercise.findByIdAndUpdate(
    req.params.id,
    { ...req.body, branches },
    { new: true, runValidators: true },
  )
  res.json(exercise)
})

router.delete('/:id', async (req, res) => {
  await Exercise.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
