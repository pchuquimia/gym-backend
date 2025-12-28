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
const MAP_FILE = process.env.CLOUDINARY_MAP_FILE || ''

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const AUTO_MAP_PATH = process.env.CLOUDINARY_AUTO_MAP || path.join(__dirname, 'cloudinary-map.auto.json')
const MANUAL_MAP_PATH = process.env.CLOUDINARY_MANUAL_MAP || path.join(__dirname, 'cloudinary-map.manual.json')

const buildAuthHeader = () => {
  const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
  return `Basic ${token}`
}

const fetchCloudinaryPage = async (cursor, prefix) => {
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
    throw new Error(`Cloudinary error ${res.status}: ${text}`)
  }

  return res.json()
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

const fetchCloudinaryResources = async () => {
  const folders = getFolderCandidates()
  const expression = buildSearchExpression(folders)
  let resources = []
  let mode = 'search'

  if (expression) {
    try {
      let cursor
      do {
        const data = await fetchCloudinarySearchPage(cursor, expression)
        resources = resources.concat(data.resources || [])
        cursor = data.next_cursor
      } while (cursor)
    } catch (_err) {
      resources = []
    }
  }

  if (!resources.length) {
    mode = 'prefix'
    for (const prefix of folders) {
      let cursor
      do {
        const data = await fetchCloudinaryPage(cursor, prefix)
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

  return { resources, mode, folders }
}

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

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'en', 'con', 'para'])

const tokenize = (value) =>
  normalizeText(value)
    .split('-')
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))

const bestMatch = (variants, exercises) => {
  if (!variants.length) return null
  let best = null
  let bestScore = -1
  let secondScore = -1

  const candidates = exercises.map((ex) => {
    const idNorm = normalizeText(ex._id || ex.id)
    const nameNorm = normalizeText(ex.name)
    return { ...ex, idNorm, nameNorm }
  })

  const scoreFor = (variant, ex) => {
    if (variant === ex.idNorm) return 4
    if (variant === ex.nameNorm) return 3
    if (variant.includes(ex.idNorm) || ex.idNorm.includes(variant)) return 2
    if (variant.includes(ex.nameNorm) || ex.nameNorm.includes(variant)) return 1

    const vTokens = tokenize(variant)
    const eTokens = tokenize(ex.nameNorm || ex.idNorm)
    if (!vTokens.length || !eTokens.length) return 0
    const intersect = vTokens.filter((t) => eTokens.includes(t)).length
    const ratio = intersect / Math.max(vTokens.length, eTokens.length)
    if (ratio >= 0.5) return 1 + intersect
    return 0
  }

  variants.forEach((variant) => {
    candidates.forEach((ex) => {
      const score = scoreFor(variant, ex)
      if (score > bestScore) {
        secondScore = bestScore
        bestScore = score
        best = ex
      } else if (score === bestScore && score > 0) {
        secondScore = score
      }
    })
  })

  if (!best || bestScore < 2 || secondScore === bestScore) return null
  return { exercise: best, score: bestScore }
}

const loadMapFile = (filePath) => {
  if (!filePath) return {}
  try {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)
    return data
  } catch {
    return {}
  }
}

const normalizeMapData = (raw, exercises) => {
  if (!raw) return {}
  const exerciseIds = new Set(exercises.map((ex) => String(ex._id || ex.id)))
  const normalized = {}

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item) return
      const exerciseId = String(item.exerciseId || item.id || '')
      const publicId = String(item.publicId || item.cloudinaryId || '')
      if (!exerciseId || !publicId) return
      normalized[publicId] = exerciseId
    })
    return normalized
  }

  if (typeof raw === 'object') {
    Object.entries(raw).forEach(([key, value]) => {
      if (!value) return
      const k = String(key)
      const v = String(value)
      if (exerciseIds.has(k)) {
        normalized[v] = k
      } else {
        normalized[k] = v
      }
    })
  }

  return normalized
}

const run = async () => {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET || !MONGO_URI) {
    throw new Error('Missing CLOUDINARY or MONGO env vars')
  }

  await connectDB(MONGO_URI)

  const exercises = await Exercise.find({}, '_id name image imagePublicId').lean()
  const autoMap = normalizeMapData(loadMapFile(AUTO_MAP_PATH), exercises)
  const manualMap = normalizeMapData(loadMapFile(MANUAL_MAP_PATH), exercises)
  const mergedMap = MAP_FILE
    ? normalizeMapData(loadMapFile(MAP_FILE), exercises)
    : { ...autoMap, ...manualMap }
  const { resources, mode, folders } = await fetchCloudinaryResources()
  let totalResources = 0
  let totalUpdates = 0
  let totalMatches = 0
  let totalSkipped = 0
  const skippedSamples = []
  const ops = []

  resources.forEach((resource) => {
    totalResources += 1
    const publicId = resource.public_id
    const manualId = mergedMap[publicId] || mergedMap[extractExerciseId(publicId)]
    const variants = buildVariants(publicId)
    const match = manualId
      ? { exercise: exercises.find((ex) => String(ex._id || ex.id) === String(manualId)), score: 99 }
      : bestMatch(variants, exercises)
    if (!match) {
      totalSkipped += 1
      if (skippedSamples.length < 10) {
        skippedSamples.push({ publicId, variants })
      }
      return
    }

    const exerciseId = match.exercise?._id || match.exercise?.id
    if (!exerciseId) {
      totalSkipped += 1
      if (skippedSamples.length < 10) {
        skippedSamples.push({ publicId, variants })
      }
      return
    }

    ops.push({
      updateOne: {
        filter: {
          _id: exerciseId,
          $or: [
            { imagePublicId: { $ne: publicId } },
            { image: { $ne: resource.secure_url } },
          ],
        },
        update: {
          $set: {
            image: resource.secure_url,
            imagePublicId: publicId,
          },
        },
      },
    })
  })

  if (ops.length) {
    const result = await Exercise.bulkWrite(ops, { ordered: false })
    totalUpdates += result.modifiedCount || 0
    totalMatches += result.matchedCount || 0
  }

  const remaining = await Exercise.countDocuments({
    $or: [{ imagePublicId: { $exists: false } }, { imagePublicId: '' }],
  })

  console.log('Cloudinary sync complete')
  console.log(`Mode: ${mode}`)
  console.log(`Folder candidates: ${folders.join(', ') || 'none'}`)
  console.log(`Resources scanned: ${totalResources}`)
  console.log(`Matched exercises: ${totalMatches}`)
  console.log(`Updated exercises: ${totalUpdates}`)
  console.log(`Skipped resources: ${totalSkipped}`)
  console.log(`Exercises missing imagePublicId: ${remaining}`)
  if (!MAP_FILE) {
    console.log(`Auto map: ${AUTO_MAP_PATH}`)
    console.log(`Manual map: ${MANUAL_MAP_PATH}`)
  } else {
    console.log(`Map file: ${MAP_FILE}`)
  }
  if (skippedSamples.length) {
    console.log('Sample skipped resources:')
    skippedSamples.forEach((item) => {
      console.log(`- ${item.publicId} -> ${item.variants.join(' | ')}`)
    })
  }

  process.exit(0)
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
