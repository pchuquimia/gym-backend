import { Router } from 'express'
import Training from '../models/Training.js'

const router = Router()

const toLocalISODate = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) {
    const offset = value.getTimezoneOffset() * 60000
    return new Date(value.getTime() - offset).toISOString().slice(0, 10)
  }
  try {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      const offset = d.getTimezoneOffset() * 60000
      return new Date(d.getTime() - offset).toISOString().slice(0, 10)
    }
  } catch (_e) {
    return null
  }
  return null
}

// GET /api/trainings?page=1&limit=200&from=YYYY-MM-DD&to=YYYY-MM-DD&fields=date,routineName
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 2000, 1), 5000)
    const from = req.query.from
    const to = req.query.to
    const fields = req.query.fields ? req.query.fields.split(',').join(' ') : null // null = all fields
    const routineId = req.query.routineId

    const filter = {}
    if (from || to) {
      filter.date = {}
      if (from) filter.date.$gte = from
      if (to) filter.date.$lte = to
    }
    if (routineId) {
      filter.routineId = routineId
    }

    const trainings = await Training.find(filter, fields || undefined)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean()

    res.set('Cache-Control', 'no-store')
    const includeMeta = req.query.meta === 'true'
    if (includeMeta) {
      res.json({ page, limit, count: trainings.length, items: trainings })
    } else {
      res.json(trainings)
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/trainings/:id
router.get('/:id', async (req, res, next) => {
  try {
    const training = await Training.findById(req.params.id).lean()
    if (!training) return res.status(404).json({ error: 'Not found' })
    res.json(training)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res) => {
  const payload = { ...req.body }
  // si viene id, usarlo como _id; si no, dejar que el schema genere uno
  if (payload.id) payload._id = payload.id
  delete payload.id
  // normalizar fecha a string local yyyy-mm-dd para evitar corrimientos por zona horaria
  const normalizedDate = toLocalISODate(payload.date)
  payload.date = normalizedDate || toLocalISODate(new Date()) || payload.date
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

// PUT /api/trainings/:id
router.put('/:id', async (req, res, next) => {
  try {
    const payload = { ...req.body }
    delete payload._id
    delete payload.id
    const normalizedDate = toLocalISODate(payload.date)
    payload.date = normalizedDate || payload.date
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
    const updated = await Training.findByIdAndUpdate(req.params.id, payload, { new: true })
    if (!updated) return res.status(404).json({ error: 'Not found' })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res) => {
  await Training.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
