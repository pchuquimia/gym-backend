import fs from "fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { isCloudinaryReady } from "./photoUpload.js";

const EXERCISE_FOLDER =
  process.env.CLOUDINARY_EXERCISES_FOLDER || "gym/exercises";

const slugify = (text = "") =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

export const buildExercisePublicId = ({
  type = "custom",
  ownerId = null,
  slug,
  kind = "main",
}) => {
  const safeSlug = slugify(slug);
  const safeKind = slugify(kind) || "main";
  if (type === "system") {
    return `${EXERCISE_FOLDER}/system/${safeSlug}/${safeKind}`;
  }
  return `${EXERCISE_FOLDER}/custom/${ownerId || "unassigned"}/${safeSlug}/${safeKind}`;
};

export const uploadExerciseMedia = async (filePath, options = {}) => {
  if (!isCloudinaryReady) return null;
  const publicId = buildExercisePublicId(options);
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: publicId,
    resource_type: "image",
    overwrite: true,
    invalidate: true,
    transformation: [
      { width: 1600, height: 1600, crop: "limit" },
      { quality: "auto:eco", fetch_format: "auto" },
    ],
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    format: result.format,
  };
};

export const deleteExerciseMedia = async (publicId) => {
  if (!isCloudinaryReady || !publicId) return null;
  return cloudinary.uploader.destroy(publicId, { invalidate: true });
};

export const removeLocalFile = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
};
