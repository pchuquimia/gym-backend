import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectDB } from '../src/config/db.js'
import Exercise from '../src/models/Exercise.js'

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const MONGO_URI = process.env.MONGO_URI
const FOLDER = process.env.CLOUDINARY_FOLDER || 'gym/exercises'
const FOLDER_ALIASES = process.env.CLOUDINARY_FOLDER_ALIASES || ''

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUTPUT_AUTO = path.join(__dirname, 'cloudinary-map.auto.json')
const OUTPUT_REVIEW = path.join(__dirname, 'cloudinary-map.review.json')

const MUSCLE_PREFIXES = new Set([
  'pecho',
  'espalda',
  'biceps',
  'triceps',
  'femoral',
  'cuadricep',
  'pantorrillas',
  'gluteo',
  'gluteos',
  'abdominales',
  'abdomen',
  'hombro',
  'hombros',
  'pierna',
  'piernas',
  'brazos',
  'brazo',
  'core',
])

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'en', 'con', 'para'])

const normalizeText = (value) => {
  if (!value) return ''
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const buildAuthHeader = () => {
  const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
  return `Basic ${token}`
}

const fetchCloudinarySearchPage = async (cursor, expression) => {
  const body = {
    expression,
    max_results: 500,
  }
  if (cursor) body.next_cursor = cursor

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloudinary search error ${res.status}: ${text}`)
  }

  return res.json()
}

const fetchCloudinaryPrefixPage = async (cursor, prefix) => {
  const params = new URLSearchParams({
    type: 'upload',
    prefix,
    max_results: '500',
  })
  if (cursor) params.set('next_cursor', cursor)

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?${params}`
  const res = await fetch(url, {
    headers: {
      Authorization: buildAuthHeader(),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloudinary prefix error ${res.status}: ${text}`)
  }

  return res.json()
}

const extractExerciseId = (publicId) => {
  if (!publicId) return ''
  if (publicId.startsWith(`${FOLDER}/`)) {
    return publicId.slice(`${FOLDER}/`.length)
  }
  if (publicId.includes('/')) {
    const parts = publicId.split('/').filter(Boolean)
    return parts[parts.length - 1] || ''
  }
  return publicId
}

const stripCloudinarySuffix = (name) => {
  if (!name) return ''
  const parts = name.split('_').filter(Boolean)
  if (!parts.length) return name
  let trimmed = parts
  const last = parts[parts.length - 1]
  if (/^[a-z0-9]{5,8}$/i.test(last) && /\d/.test(last)) {
    trimmed = parts.slice(0, -1)
  }
  const lastAfter = trimmed[trimmed.length - 1]
  if (lastAfter && /^\d{2,4}x\d{2,4}$/i.test(lastAfter)) {
    trimmed = trimmed.slice(0, -1)
  }
  return trimmed.join('_')
}

const dropMusclePrefix = (name) => {
  const parts = name.split('_').filter(Boolean)
  if (parts.length > 1 && MUSCLE_PREFIXES.has(parts[0])) {
    return parts.slice(1).join('_')
  }
  return name
}

const buildVariants = (publicId) => {
  const base = extractExerciseId(publicId)
  if (!base) return []
  const cleaned = stripCloudinarySuffix(base)
  const cleanedNoPrefix = dropMusclePrefix(cleaned)
  const raw = normalizeText(base.replace(/_/g, '-'))
  const cleanedNorm = normalizeText(cleaned.replace(/_/g, '-'))
  const noPrefixNorm = normalizeText(cleanedNoPrefix.replace(/_/g, '-'))
  return Array.from(new Set([raw, cleanedNorm, noPrefixNorm].filter(Boolean)))
}

const getMusclePrefix = (publicId) => {
  const base = extractExerciseId(publicId)
  if (!base) return ''
  const prefix = base.split('_')[0]
  return MUSCLE_PREFIXES.has(prefix) ? prefix : ''
}

const tokenize = (value) =>
  normalizeText(value)
    .split('-')
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))

const scoreExercise = (variant, exercise, musclePrefix) => {
  const idNorm = exercise.idNorm
  const nameNorm = exercise.nameNorm
  if (variant === idNorm) return 5
  if (variant === nameNorm) return 4
  if (variant.includes(idNorm) || idNorm.includes(variant)) return 3
  if (variant.includes(nameNorm) || nameNorm.includes(variant)) return 2

  const vTokens = tokenize(variant)
  const eTokens = tokenize(nameNorm || idNorm)
  if (!vTokens.length || !eTokens.length) return 0
  const intersect = vTokens.filter((t) => eTokens.includes(t)).length
  const ratio = intersect / Math.max(vTokens.length, eTokens.length)
  let score = ratio >= 0.5 ? 1 + intersect : 0

  if (musclePrefix && normalizeText(exercise.muscle) === musclePrefix) {
    score += 1
  }

  return score
}

const buildCandidates = (variants, exercises, musclePrefix) => {
  const scores = new Map()
  variants.forEach((variant) => {
    exercises.forEach((ex) => {
      const score = scoreExercise(variant, ex, musclePrefix)
      if (!score) return
      const prev = scores.get(ex._id) || 0
      if (score > prev) scores.set(ex._id, score)
    })
  })
  return Array.from(scores.entries())
    .map(([id, score]) => {
      const ex = exercises.find((e) => String(e._id) === String(id))
      return { id, score, name: ex?.name || '', muscle: ex?.muscle || '' }
    })
    .sort((a, b) => b.score - a.score)
}

const run = async () => {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET || !MONGO_URI) {
    throw new Error('Missing CLOUDINARY or MONGO env vars')
  }

  await connectDB(MONGO_URI)
  const exercises = await Exercise.find({}, '_id name muscle').lean()
  const normalized = exercises.map((ex) => ({
    ...ex,
    idNorm: normalizeText(ex._id),
    nameNorm: normalizeText(ex.name),
  }))

  const folders = getFolderCandidates()
  const expression = buildSearchExpression(folders)

  let resources = []
  let cursor
  let mode = 'search'
  if (expression) {
    try {
      do {
        const data = await fetchCloudinarySearchPage(cursor, expression)
        resources = resources.concat(data.resources || [])
        cursor = data.next_cursor
      } while (cursor)
    } catch (err) {
      resources = []
      cursor = undefined
    }
  }

  if (!resources.length) {
    mode = 'prefix'
    for (const prefix of folders) {
      cursor = undefined
      do {
        const data = await fetchCloudinaryPrefixPage(cursor, prefix)
        resources = resources.concat(data.resources || [])
        cursor = data.next_cursor
      } while (cursor)
    }
  }

  if (!resources.length) {
    throw new Error(
      `No Cloudinary resources found. Check CLOUDINARY_FOLDER or set CLOUDINARY_FOLDER_ALIASES. Candidates: ${folders.join(
        ', ',
      )}`,
    )
  }

  const autoMap = {}
  const review = []

  resources.forEach((resource) => {
    const publicId = resource.public_id
    const variants = buildVariants(publicId)
    const musclePrefix = getMusclePrefix(publicId)
    const candidates = buildCandidates(variants, normalized, musclePrefix)
    const best = candidates[0]
    const second = candidates[1]

    if (best && best.score >= 2 && (!second || best.score > second.score)) {
      autoMap[publicId] = best.id
      return
    }

    review.push({
      publicId,
      suggestions: candidates.slice(0, 5),
    })
  })

  fs.writeFileSync(OUTPUT_AUTO, JSON.stringify(autoMap, null, 2))
  fs.writeFileSync(OUTPUT_REVIEW, JSON.stringify(review, null, 2))

  console.log('Cloudinary map build complete')
  console.log(`Mode: ${mode}`)
  console.log(`Folder candidates: ${folders.join(', ') || 'none'}`)
  console.log(`Resources scanned: ${resources.length}`)
  console.log(`Auto matches: ${Object.keys(autoMap).length}`)
  console.log(`Needs review: ${review.length}`)
  console.log(`Auto map: ${OUTPUT_AUTO}`)
  console.log(`Review list: ${OUTPUT_REVIEW}`)
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
const getFolderCandidates = () => {
  const candidates = []
  if (FOLDER) candidates.push(FOLDER)
  if (FOLDER.includes('/')) {
    const parts = FOLDER.split('/').filter(Boolean)
    if (parts.length) candidates.push(parts[parts.length - 1])
  }
  if (FOLDER_ALIASES) {
    FOLDER_ALIASES.split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => candidates.push(value))
  }
  return Array.from(new Set(candidates))
}

const buildSearchExpression = (folders) => {
  if (!folders.length) return ''
  return folders
    .map((folder) => `(asset_folder:"${folder}" OR folder:"${folder}")`)
    .join(' OR ')
}
