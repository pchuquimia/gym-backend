import fs from "fs/promises";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import Photo from "../src/models/Photo.js";
import {
  filenameFromStoredUrl,
  privatePhotoUploadsDir,
  publicUploadsDir,
  safeStoredFilePath,
} from "../src/utils/photoStorage.js";

loadBackendEnvironment();

const apply = process.argv.includes("--apply");

const fileExists = async (filePath) => {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const probeLegacyUrl = async (url) => {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(7_000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
};

const getStorageUpdate = async (photo) => {
  if (photo.publicId) {
    return { storage: "cloudinary", contentStatus: "available" };
  }
  if (photo.localFilename) {
    const directory =
      photo.storage === "legacy-local"
        ? publicUploadsDir
        : privatePhotoUploadsDir;
    const available = await fileExists(
      safeStoredFilePath(directory, photo.localFilename),
    );
    return {
      storage:
        photo.storage === "legacy-local" ? "legacy-local" : "private-local",
      contentStatus: available ? "available" : "missing",
    };
  }
  if (String(photo.url || "").includes("/uploads/")) {
    const localFilename = filenameFromStoredUrl(photo.url);
    const localPath = safeStoredFilePath(publicUploadsDir, localFilename);
    const available =
      (await fileExists(localPath)) || (await probeLegacyUrl(photo.url));
    return {
      storage: "legacy-local",
      localFilename,
      contentStatus: available ? "available" : "missing",
    };
  }
  return {
    storage: "external",
    contentStatus: (await probeLegacyUrl(photo.url)) ? "available" : "missing",
  };
};

await mongoose.connect(
  process.env.MONGO_URI || "mongodb://localhost:27017/gym",
);

try {
  const photos = await Photo.find({}).lean();
  const updates = [];
  let missingAssets = 0;
  for (const photo of photos) {
    const storageUpdate = await getStorageUpdate(photo);
    if (storageUpdate.contentStatus === "missing") missingAssets += 1;
    const set = {
      ...(photo.view ? {} : { view: "front" }),
      ...(photo.visibility ? {} : { visibility: "private" }),
      ...storageUpdate,
    };
    const changed = Object.entries(set).some(
      ([key, value]) => String(photo[key] ?? "") !== String(value ?? ""),
    );
    if (changed) updates.push({ id: photo._id, set });
  }

  const summary = {
    mode: apply ? "apply" : "audit",
    scanned: photos.length,
    updates: updates.length,
    missingAssets,
    defaultedViews: updates.filter((item) => item.set.view === "front").length,
    privateByDefault: updates.filter(
      (item) => item.set.visibility === "private",
    ).length,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (apply && updates.length) {
    await Photo.bulkWrite(
      updates.map((item) => ({
        updateOne: { filter: { _id: item.id }, update: { $set: item.set } },
      })),
      { ordered: true },
    );
  }
} finally {
  await mongoose.disconnect();
}
