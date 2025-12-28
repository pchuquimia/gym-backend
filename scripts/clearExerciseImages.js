import 'dotenv/config'
import { connectDB } from '../src/config/db.js'
import Exercise from '../src/models/Exercise.js'

const MONGO_URI = process.env.MONGO_URI
const CLEAR_ALL = process.env.CLEAR_ALL === 'true'

const run = async () => {
  if (!MONGO_URI) throw new Error('Missing MONGO_URI')
  await connectDB(MONGO_URI)

  const filter = CLEAR_ALL ? {} : { imagePublicId: { $exists: true, $ne: '' } }
  const res = await Exercise.updateMany(filter, { $unset: { image: '', thumb: '' } })
  const remaining = await Exercise.countDocuments({
    $or: [{ imagePublicId: { $exists: false } }, { imagePublicId: '' }],
  })

  console.log('Clear exercise images complete')
  console.log(`Mode: ${CLEAR_ALL ? 'all' : 'only with imagePublicId'}`)
  console.log(`Modified: ${res.modifiedCount}`)
  console.log(`Exercises missing imagePublicId: ${remaining}`)
  process.exit(0)
}

run().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
