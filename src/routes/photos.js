import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import Photo from '../models/Photo.js'

const router = Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// resolve to backend/uploads (one level above src)
const uploadsDir = path.resolve(__dirname, '../../uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`
    cb(null, unique)
  },
})

const upload = multer({ storage })

router.get('/', async (req, res) => {
  const { type } = req.query
  const filter = type ? { type } : {}
  const photos = await Photo.find(filter).lean()
  res.json(photos)
})

router.post('/', async (req, res) => {
  const photo = await Photo.create(req.body)
  res.status(201).json(photo)
})

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const { date, label, type, sessionId, ownerId } = req.body
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`
  const url = `${baseUrl}/uploads/${req.file.filename}`
  const photo = await Photo.create({
    date: date || new Date().toISOString().slice(0, 10),
    label: label || '',
    type: type || 'gym',
    sessionId: sessionId || null,
    ownerId: ownerId || null,
    url,
  })
  res.status(201).json(photo)
})

router.put('/:id', async (req, res) => {
  const photo = await Photo.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(photo)
})

router.delete('/:id', async (req, res) => {
  await Photo.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router
