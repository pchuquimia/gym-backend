import PhotoAssetCleanupJob from "../models/PhotoAssetCleanupJob.js";
import {
  deletePhotoFromCloudinary,
  removeLocalFile,
} from "../utils/photoUpload.js";
import {
  filenameFromStoredUrl,
  privatePhotoUploadsDir,
  publicUploadsDir,
  safeStoredFilePath,
} from "../utils/photoStorage.js";

export const describePhotoAsset = (photo = {}) => {
  if (photo.publicId) {
    return {
      publicId: photo.publicId,
      deliveryType: photo.deliveryType || "upload",
      storage: "cloudinary",
    };
  }
  if (!photo.localFilename && !String(photo.url || "").includes("/uploads/")) {
    return null;
  }
  const localFilename =
    photo.localFilename || filenameFromStoredUrl(photo.url || "");
  if (!localFilename) return null;
  return {
    storage:
      photo.storage === "private-local" ? "private-local" : "legacy-local",
    localFilename,
  };
};

export const queuePhotoAssetCleanup = async (photos, { session } = {}) => {
  const descriptors = (Array.isArray(photos) ? photos : [photos])
    .map(describePhotoAsset)
    .filter(Boolean);
  if (!descriptors.length) return [];
  return PhotoAssetCleanupJob.insertMany(descriptors, {
    ...(session ? { session } : {}),
    ordered: true,
  });
};

const deleteQueuedAsset = async (job) => {
  if (job.storage === "cloudinary") {
    await deletePhotoFromCloudinary(job.publicId, job.deliveryType || "upload");
    return;
  }
  const directory =
    job.storage === "private-local" ? privatePhotoUploadsDir : publicUploadsDir;
  const filePath = safeStoredFilePath(directory, job.localFilename);
  if (filePath) await removeLocalFile(filePath);
};

export const processPhotoAssetCleanupJobs = async ({
  ids,
  limit = 100,
} = {}) => {
  const filter = ids?.length ? { _id: { $in: ids } } : {};
  const jobs = await PhotoAssetCleanupJob.find(filter)
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 500)));
  const result = { completed: 0, pending: 0 };
  for (const job of jobs) {
    try {
      await deleteQueuedAsset(job);
      await PhotoAssetCleanupJob.deleteOne({ _id: job._id });
      result.completed += 1;
    } catch (error) {
      job.attempts += 1;
      job.lastError = String(
        error?.message || "No se pudo eliminar el archivo",
      ).slice(0, 500);
      await job.save();
      result.pending += 1;
    }
  }
  return result;
};

export const queueAndProcessPhotoAssetCleanup = async (photos) => {
  const jobs = await queuePhotoAssetCleanup(photos);
  return processPhotoAssetCleanupJobs({ ids: jobs.map((job) => job._id) });
};
