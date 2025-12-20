import { Router } from 'express'
import Training from '../models/Training.js'
import Preference from '../models/Preference.js'

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

const toIsoWeek = (iso) => {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// GET /api/trainings/summary?from=&to=&routineId=
router.get('/summary', async (req, res, next) => {
  try {
    const { from, to, routineId } = req.query
    const filter = {}
    if (from || to) {
      filter.date = {}
      if (from) filter.date.$gte = from
      if (to) filter.date.$lte = to
    }
    if (routineId) filter.routineId = routineId

    // Obtenemos las últimas 300 sesiones para el rango solicitado (suficiente para dashboard)
    const trainings = await Training.find(filter, 'date routineId routineName branch routineBranch durationSeconds totalVolume exercises')
      .sort({ date: -1 })
      .limit(300)
      .lean()

    // Volumen total y gráfica semanal
    const byWeek = new Map()
    let totalVolume = 0
    trainings.forEach((t) => {
      const date = t.date || t.createdAt
      if (!date) return
      const vol =
        typeof t.totalVolume === 'number'
          ? t.totalVolume
          : (t.exercises || []).reduce((acc, ex) => {
              const sets = Array.isArray(ex.sets) ? ex.sets : []
              const v = sets.reduce((s, set) => s + Number(set.weightKg || 0) * Number(set.reps || 0), 0)
              return acc + v
            }, 0)
      totalVolume += vol
      const wk = toIsoWeek(date)
      if (!wk) return
      byWeek.set(wk, (byWeek.get(wk) || 0) + vol)
    })

    const chart = Array.from(byWeek.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([x, y]) => ({ x, y }))

    const sessionsCount = trainings.length

    // Objetivos desde preferencias
    let objectives = []
    try {
      const pref = await Preference.findOne({ userId: 'default' }).lean()
      if (pref?.goals) {
        objectives = Object.entries(pref.goals).map(([key, obj]) => ({
          key,
          label: obj.label || key,
          value: Number(obj.current) || 0,
          goal: Number(obj.target) || 0,
          unit: obj.unit || 'kg',
        }))
      }
    } catch (_e) {
      objectives = []
    }

    // Recent sessions ligeras
    const recentSessions = trainings.slice(0, 5).map((t) => ({
      id: t._id || t.id,
      date: t.date,
      routineId: t.routineId,
      routineName: t.routineName,
      branch: t.branch || t.routineBranch,
      totalVolume: t.totalVolume,
      durationSeconds: t.durationSeconds,
    }))

    res.set('Cache-Control', 'public, max-age=120')
    res.json({
      chart,
      totalVolume,
      sessionsCount,
      prs: 0, // se puede calcular después con endpoint dedicado
      recentSessions,
      objectives,
    })
  } catch (err) {
    next(err)
  }
})

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
    const fields = req.query.fields ? req.query.fields.split(',').join(' ') : undefined
    const training = await Training.findById(req.params.id, fields).lean()
    if (!training) return res.status(404).json({ error: 'Not found' })
    res.set('Cache-Control', 'public, max-age=120')
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
