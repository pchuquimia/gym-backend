import fs from 'fs/promises'
import { v2 as cloudinary } from 'cloudinary'

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

export const isCloudinaryReady = Boolean(cloudName && apiKey && apiSecret)

if (isCloudinaryReady) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  })
}

const PHOTO_FOLDER = process.env.CLOUDINARY_PHOTOS_FOLDER || 'gym/photos'

export const uploadPhotoToCloudinary = async (filePath) => {
  if (!isCloudinaryReady) return null
  const result = await cloudinary.uploader.upload(filePath, {
    folder: PHOTO_FOLDER,
    resource_type: 'image',
    overwrite: true,
    transformation: [
      { width: 1600, height: 1600, crop: 'limit' },
      { quality: 'auto:eco', fetch_format: 'auto' },
    ],
  })
  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    format: result.format,
  }
}

export const removeLocalFile = async (filePath) => {
  if (!filePath) return
  try {
    await fs.unlink(filePath)
  } catch {
    // ignore cleanup errors
  }
}
