import { Router } from 'express'
import Exercise from '../models/Exercise.js'

const cloudinaryPublicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return ''
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('res.cloudinary.com')) return ''
    const parts = parsed.pathname.split('/').filter(Boolean)
    const uploadIndex = parts.indexOf('upload')
    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return ''
    let rest = parts.slice(uploadIndex + 1)
    if (rest[0]?.startsWith('v') && /^\d+$/.test(rest[0].slice(1))) {
      rest = rest.slice(1)
    }
    if (rest[0] && rest[0].includes(',')) {
      rest = rest.slice(1)
    }
    const filename = rest.join('/')
    return filename.replace(/\.[^.]+$/, '')
  } catch {
    return ''
  }
}

const normalizePayload = (body) => {
  const payload = { ...body }
  if (!payload.imagePublicId && payload.image) {
    const publicId = cloudinaryPublicIdFromUrl(payload.image)
    if (publicId) payload.imagePublicId = publicId
  }
  return payload
}

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
      : 'name muscle branches type image imagePublicId thumb updatedAt createdAt'

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
  const payload = normalizePayload(req.body)
  const exercise = await Exercise.create({ ...payload, branches })
  res.status(201).json(exercise)
})

router.put('/:id', async (req, res) => {
  const branches = Array.isArray(req.body.branches) && req.body.branches.length ? req.body.branches : ['general']
  const payload = normalizePayload(req.body)
  const exercise = await Exercise.findByIdAndUpdate(
    req.params.id,
    { ...payload, branches },
    { new: true, runValidators: true },
  )
  res.json(exercise)
})

router.delete('/:id', async (req, res) => {
  await Exercise.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
