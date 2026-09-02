import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const publicUploadsDir = path.resolve(__dirname, "../../uploads");
export const privatePhotoUploadsDir = path.resolve(
  __dirname,
  "../../private-uploads/photos",
);

export const ensurePhotoStorageDirectories = () => {
  for (const directory of [publicUploadsDir, privatePhotoUploadsDir]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  }
};

export const filenameFromStoredUrl = (value = "") => {
  try {
    return path.basename(new URL(String(value)).pathname);
  } catch {
    return "";
  }
};

export const safeStoredFilePath = (directory, filename = "") => {
  const safeName = path.basename(String(filename || ""));
  if (!safeName || safeName !== filename) return "";
  const candidate = path.resolve(directory, safeName);
  return candidate.startsWith(`${path.resolve(directory)}${path.sep}`)
    ? candidate
    : "";
};
