import "dotenv/config";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import Exercise from "../src/models/Exercise.js";
import {
  DATASET_BASE_URL,
  DATASET_PROVIDER,
} from "./exerciseDatasetConfig.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const force = argv.includes("--force");
const getNumberArg = (name, fallback) => {
  const prefix = `${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? Number(value.slice(prefix.length)) : fallback;
};
const limit = getNumberArg("--limit", 0);
const concurrency = Math.min(Math.max(getNumberArg("--concurrency", 4), 1), 8);
const folder =
  process.env.CLOUDINARY_EXERCISES_FOLDER || "gym/exercises";

const requiredEnv = [
  "MONGO_URI",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const toSourceUrl = (relativePath) =>
  `${DATASET_BASE_URL}/${String(relativePath || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

const toAsset = (result) => ({
  url: result.secure_url,
  publicId: result.public_id,
  width: result.width || null,
  height: result.height || null,
  format: result.format || "",
  bytes: result.bytes || null,
});

const uploadWithRetry = async (sourceUrl, publicId, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await cloudinary.uploader.upload(sourceUrl, {
        public_id: publicId,
        resource_type: "image",
        overwrite: true,
        invalidate: true,
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  throw lastError;
};

const processExercise = async (exercise) => {
  const externalId = exercise.source.externalId;
  const basePublicId = `${folder}/system/${DATASET_PROVIDER}/${externalId}`;
  const currentMedia = exercise.media?.toObject?.() || exercise.media || {};
  const updates = {};

  if (exercise.source.imagePath && (force || !currentMedia.thumbnail?.url)) {
    const result = await uploadWithRetry(
      toSourceUrl(exercise.source.imagePath),
      `${basePublicId}/thumbnail`,
    );
    const asset = toAsset(result);
    updates["media.thumbnail"] = asset;
    updates["media.image"] = asset;
    updates.image = asset.url;
    updates.thumb = asset.url;
    updates.imagePublicId = asset.publicId;
  }

  if (
    exercise.source.animationPath &&
    (force || !currentMedia.animation?.url)
  ) {
    const result = await uploadWithRetry(
      toSourceUrl(exercise.source.animationPath),
      `${basePublicId}/animation`,
    );
    updates["media.animation"] = toAsset(result);
  }

  if (Object.keys(updates).length) {
    await Exercise.updateOne({ _id: exercise._id }, { $set: updates });
  }
  return Object.keys(updates).length > 0;
};

const runWorkers = async (items) => {
  let cursor = 0;
  let uploaded = 0;
  const failures = [];
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const exercise = items[index];
      try {
        if (await processExercise(exercise)) uploaded += 1;
        if ((index + 1) % 25 === 0 || index + 1 === items.length) {
          console.log(`Media progress: ${index + 1}/${items.length}`);
        }
      } catch (error) {
        failures.push({
          exerciseId: exercise._id,
          externalId: exercise.source.externalId,
          error: error.message,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { uploaded, failures };
};

const main = async () => {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  await mongoose.connect(process.env.MONGO_URI);

  const filter = { type: "system", "source.provider": DATASET_PROVIDER };
  if (!force) {
    filter.$or = [
      { "media.thumbnail.url": { $in: [null, ""] } },
      { "media.animation.url": { $in: [null, ""] } },
      { "media.thumbnail.url": { $exists: false } },
      { "media.animation.url": { $exists: false } },
    ];
  }
  let query = Exercise.find(filter, "source media").sort({ _id: 1 });
  if (limit > 0) query = query.limit(limit);
  const exercises = await query;

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          candidates: exercises.length,
          concurrency,
          force,
          folder: `${folder}/system/${DATASET_PROVIDER}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await runWorkers(exercises);
  console.log(
    JSON.stringify(
      {
        mode: "applied",
        candidates: exercises.length,
        uploadedOrUpdated: result.uploaded,
        failed: result.failures.length,
        failures: result.failures.slice(0, 50),
      },
      null,
      2,
    ),
  );
  if (result.failures.length) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
