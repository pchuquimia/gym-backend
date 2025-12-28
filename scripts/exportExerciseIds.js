import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectDB } from '../src/config/db.js'
import Exercise from '../src/models/Exercise.js'

const MONGO_URI = process.env.MONGO_URI
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUTPUT = path.join(__dirname, 'cloudinary-map.template.json')

const run = async () => {
  if (!MONGO_URI) throw new Error('Missing MONGO_URI')
  await connectDB(MONGO_URI)

  const exercises = await Exercise.find({}, '_id name').lean()
  const template = {}
  exercises
    .map((ex) => String(ex._id || ex.id))
    .sort((a, b) => a.localeCompare(b))
    .forEach((id) => {
      template[id] = ''
    })

  fs.writeFileSync(OUTPUT, JSON.stringify(template, null, 2))
  console.log(`Template saved: ${OUTPUT}`)
  process.exit(0)
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
