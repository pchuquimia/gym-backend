import { Router } from "express";
import multer from "multer";
import fs from "fs/promises";
import Photo from "../models/Photo.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
import User from "../models/User.js";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import {
  uploadPhotoToCloudinary,
  removeLocalFile,
  isCloudinaryReady,
  getPhotoDeliveryUrl,
} from "../utils/photoUpload.js";
import {
  ensurePhotoStorageDirectories,
  filenameFromStoredUrl,
  privatePhotoUploadsDir,
  publicUploadsDir,
  safeStoredFilePath,
} from "../utils/photoStorage.js";
import {
  processPhotoAssetCleanupJobs,
  queueAndProcessPhotoAssetCleanup,
  queuePhotoAssetCleanup,
} from "../services/photoAssetCleanupService.js";

const router = Router();
ensurePhotoStorageDirectories();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, privatePhotoUploadsDir),
  filename: (_req, file, cb) => {
    const extensions = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extensions[file.mimetype] || ""}`;
    cb(null, unique);
  },
});

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedPhotoTypes = new Set(["gym", "home", "profile"]);
const allowedPhotoViews = new Set(["front", "side", "back", "other"]);
const allowedVisibilities = new Set(["private", "coach"]);
const PHOTO_FIELDS = [
  "date",
  "label",
  "type",
  "view",
  "sessionId",
  "routineName",
  "visibility",
];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedImageTypes.has(file.mimetype)) return cb(null, true);
    const error = new Error("Solo se permiten imágenes JPG, PNG o WebP");
    error.code = "INVALID_IMAGE_TYPE";
    return cb(error);
  },
});

const receivePhoto = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "La imagen no puede superar 5 MB" });
    }
    return res.status(400).json({
      error: error.message || "No se pudo procesar la imagen",
    });
  });
};

router.use(protect);

export const normalizePhotoDate = (value, { allowFuture = false } = {}) => {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
  ) {
    return "";
  }
  const today = new Date().toLocaleDateString("en-CA");
  return !allowFuture && candidate > today ? "" : candidate;
};

const parseAllowedLegacyUrl = (value, req) => {
  try {
    const appUrl =
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const parsed = new URL(String(value || ""), appUrl);
    const appHost = new URL(appUrl).host;
    const isLocalUpload =
      parsed.host === appHost && parsed.pathname.startsWith("/uploads/");
    const isCloudinary =
      parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com";
    return isLocalUpload || isCloudinary ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const detectImageMime = async (filePath) => {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (
      bytesRead >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return "image/jpeg";
    }
    if (
      bytesRead >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return "image/png";
    }
    if (
      bytesRead >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }
    return "";
  } finally {
    await handle.close();
  }
};

const validateUploadedFile = async (file) => {
  if (!file) {
    const error = new Error("Selecciona una imagen");
    error.statusCode = 400;
    throw error;
  }
  const detectedMime = await detectImageMime(file.path);
  if (!detectedMime || detectedMime !== file.mimetype) {
    const error = new Error("El archivo no contiene una imagen válida");
    error.statusCode = 400;
    throw error;
  }
  return detectedMime;
};

const serializePhoto = (photo) => {
  const value = photo?.toObject?.() || photo || {};
  const {
    url: _url,
    publicId: _publicId,
    localFilename: _localFilename,
    deliveryType: _deliveryType,
    ...safe
  } = value;
  const id = String(value._id || value.id || "");
  return {
    ...safe,
    _id: value._id,
    contentStatus: value.contentStatus || "available",
    contentUrl: id ? `/api/photos/${id}/content` : "",
  };
};

const requestedOwnerId = async (req, { allowAssignedCoach = false } = {}) => {
  const ownerId = String(
    req.body?.ownerId || req.query?.athleteId || req.user.id,
  );
  if (ownerId !== String(req.user.id)) {
    if (allowAssignedCoach && (await ensureCanAccessOwner(req, ownerId))) {
      return ownerId;
    }
    const error = new Error("No autorizado para administrar estas fotos");
    error.statusCode = 403;
    throw error;
  }
  return ownerId;
};

const getPhotoReadFilter = async (req, baseFilter = {}) => {
  const filter = await getAccessibleOwnerFilter(req, baseFilter);
  if (String(filter.ownerId) !== String(req.user.id)) {
    return { ...filter, visibility: "coach" };
  }
  return filter;
};

const canReadPhoto = async (req, photo) => {
  if (String(photo.ownerId) === String(req.user.id)) return true;
  if (photo.visibility !== "coach") return false;
  return ensureCanAccessOwner(req, photo.ownerId);
};

const normalizeChoice = (value, allowed, fallback, label) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (allowed.has(value)) return value;
  const error = new Error(`${label} inválido`);
  error.statusCode = 400;
  throw error;
};

const validateSessionLink = async (ownerId, value) => {
  const sessionId = String(value || "").trim();
  if (!sessionId) return null;
  const [training, legacySession] = await Promise.all([
    Training.exists({ _id: sessionId, ownerId }),
    Session.exists({ _id: sessionId, ownerId }),
  ]);
  if (!training && !legacySession) {
    const error = new Error(
      "La sesión seleccionada no pertenece a esta cuenta",
    );
    error.statusCode = 400;
    throw error;
  }
  return sessionId;
};

const storeUploadedFile = async (file, mimeType) => {
  if (isCloudinaryReady) {
    const uploaded = await uploadPhotoToCloudinary(file.path);
    await removeLocalFile(file.path);
    return {
      url: uploaded.url,
      publicId: uploaded.publicId,
      deliveryType: uploaded.deliveryType || "authenticated",
      storage: "cloudinary",
      localFilename: "",
      mimeType,
      bytes: uploaded.bytes || file.size || null,
      width: uploaded.width || null,
      height: uploaded.height || null,
      contentStatus: "available",
    };
  }
  if (process.env.NODE_ENV === "production") {
    await removeLocalFile(file.path);
    const error = new Error(
      "El almacenamiento privado de fotos no está disponible",
    );
    error.statusCode = 503;
    throw error;
  }
  return {
    url: "",
    publicId: "",
    deliveryType: "upload",
    storage: "private-local",
    localFilename: file.filename,
    mimeType,
    bytes: file.size || null,
    width: null,
    height: null,
    contentStatus: "available",
  };
};

const localContentPath = (photo) => {
  if (photo.localFilename) {
    return safeStoredFilePath(
      photo.storage === "legacy-local"
        ? publicUploadsDir
        : privatePhotoUploadsDir,
      photo.localFilename,
    );
  }
  if (!String(photo.url || "").includes("/uploads/")) return "";
  const legacyFilename = filenameFromStoredUrl(photo.url || "");
  return safeStoredFilePath(publicUploadsDir, legacyFilename);
};

router.get("/summary", async (req, res, next) => {
  try {
    const filter = await getPhotoReadFilter(req, {});
    const [result] = await Photo.aggregate([
      { $match: filter },
      { $match: { type: { $ne: "profile" } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          available: {
            $sum: {
              $cond: [{ $ne: ["$contentStatus", "missing"] }, 1, 0],
            },
          },
          missing: {
            $sum: { $cond: [{ $eq: ["$contentStatus", "missing"] }, 1, 0] },
          },
          gym: { $sum: { $cond: [{ $eq: ["$type", "gym"] }, 1, 0] } },
          home: { $sum: { $cond: [{ $eq: ["$type", "home"] }, 1, 0] } },
          lastDate: { $max: "$date" },
        },
      },
    ]);
    res.set("Cache-Control", "private, no-store");
    res.json(
      result || {
        total: 0,
        available: 0,
        missing: 0,
        gym: 0,
        home: 0,
        lastDate: null,
      },
    );
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      100,
    );
    const baseFilter = {};
    if (allowedPhotoTypes.has(req.query.type)) baseFilter.type = req.query.type;
    else if (req.query.includeProfile !== "true") {
      baseFilter.type = { $ne: "profile" };
    }
    if (allowedPhotoViews.has(req.query.view)) baseFilter.view = req.query.view;
    const filter = await getPhotoReadFilter(req, baseFilter);
    const photos = await Photo.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    res.set("Cache-Control", "private, no-store");
    if (req.query.meta === "true") {
      const total = await Photo.countDocuments(filter);
      return res.json({
        page,
        limit,
        total,
        count: photos.length,
        items: photos.map(serializePhoto),
      });
    }
    res.json(photos.map(serializePhoto));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/content", async (req, res, next) => {
  try {
    const photo = await Photo.findById(req.params.id).lean();
    if (!photo) return res.status(404).json({ error: "Foto no encontrada" });
    if (!(await canReadPhoto(req, photo))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (photo.contentStatus === "missing") {
      return res.status(404).json({ error: "Imagen no disponible" });
    }

    const width = Math.min(
      Math.max(parseInt(req.query.width, 10) || 1600, 160),
      2000,
    );
    const height = Math.min(
      Math.max(parseInt(req.query.height, 10) || 1600, 160),
      2000,
    );
    const filePath = localContentPath(photo);
    if (filePath) {
      try {
        await fs.access(filePath);
      } catch {
        await Photo.updateOne(
          { _id: photo._id },
          { $set: { contentStatus: "missing" } },
        );
        return res.status(404).json({ error: "Imagen no disponible" });
      }
      res.set("Cache-Control", "private, max-age=300");
      return res.sendFile(filePath);
    }

    const source = photo.publicId
      ? getPhotoDeliveryUrl({
          publicId: photo.publicId,
          deliveryType: photo.deliveryType || "upload",
          width,
          height,
        })
      : parseAllowedLegacyUrl(photo.url, req);
    if (!source) return res.status(404).json({ error: "Imagen no disponible" });
    const response = await fetch(source);
    if (!response.ok) {
      if ([404, 410].includes(response.status)) {
        await Photo.updateOne(
          { _id: photo._id },
          { $set: { contentStatus: "missing" } },
        );
      }
      return res.status(502).json({ error: "No se pudo recuperar la imagen" });
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=300");
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    await requestedOwnerId(req);
    return res.status(400).json({
      error: "La foto debe subirse como un archivo privado",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/upload", receivePhoto, async (req, res, next) => {
  let stored;
  try {
    const mimeType = await validateUploadedFile(req.file);
    const ownerId = await requestedOwnerId(req, { allowAssignedCoach: true });
    const uploadedByCoach = ownerId !== String(req.user.id);
    const date = normalizePhotoDate(req.body.date);
    if (!date) {
      await removeLocalFile(req.file.path);
      return res.status(400).json({ error: "Fecha inválida" });
    }
    const sessionId = await validateSessionLink(ownerId, req.body.sessionId);
    stored = await storeUploadedFile(req.file, mimeType);
    const photo = await Photo.create({
      ...stored,
      date,
      label: String(req.body.label || "")
        .trim()
        .slice(0, 240),
      type: normalizeChoice(
        req.body.type,
        allowedPhotoTypes,
        "gym",
        "Contexto",
      ),
      view: normalizeChoice(req.body.view, allowedPhotoViews, "front", "Vista"),
      visibility: normalizeChoice(
        uploadedByCoach ? "coach" : req.body.visibility,
        allowedVisibilities,
        "private",
        "Visibilidad",
      ),
      sessionId,
      ownerId,
      routineName: String(req.body.routineName || "")
        .trim()
        .slice(0, 120),
    });
    return res.status(201).json(serializePhoto(photo));
  } catch (error) {
    await removeLocalFile(req.file?.path);
    if (stored) await queueAndProcessPhotoAssetCleanup(stored);
    next(error);
  }
});

router.post("/:id/replace", receivePhoto, async (req, res, next) => {
  let stored;
  let dbSession;
  let previousAssetJobs = [];
  try {
    const current = await Photo.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Foto no encontrada" });
    if (String(current.ownerId) !== String(req.user.id)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const mimeType = await validateUploadedFile(req.file);
    stored = await storeUploadedFile(req.file, mimeType);
    dbSession = await Photo.startSession();
    let photo;
    await dbSession.withTransaction(async () => {
      previousAssetJobs = await queuePhotoAssetCleanup(current, {
        session: dbSession,
      });
      photo = await Photo.findByIdAndUpdate(
        current._id,
        { $set: stored },
        { new: true, runValidators: true, session: dbSession },
      );
    });
    await processPhotoAssetCleanupJobs({
      ids: previousAssetJobs.map((job) => job._id),
    });
    return res.json(serializePhoto(photo));
  } catch (error) {
    await removeLocalFile(req.file?.path);
    if (stored) await queueAndProcessPhotoAssetCleanup(stored);
    next(error);
  } finally {
    await dbSession?.endSession();
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await Photo.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Foto no encontrada" });
    if (String(current.ownerId) !== String(req.user.id)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const payload = {};
    PHOTO_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        payload[field] = req.body[field];
      }
    });
    if (Object.prototype.hasOwnProperty.call(payload, "date")) {
      payload.date = normalizePhotoDate(payload.date);
      if (!payload.date) {
        return res.status(400).json({ error: "Fecha inválida" });
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "type")) {
      payload.type = normalizeChoice(
        payload.type,
        allowedPhotoTypes,
        current.type || "gym",
        "Contexto",
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "view")) {
      payload.view = normalizeChoice(
        payload.view,
        allowedPhotoViews,
        current.view || "front",
        "Vista",
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "visibility")) {
      payload.visibility = normalizeChoice(
        payload.visibility,
        allowedVisibilities,
        current.visibility || "private",
        "Visibilidad",
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "sessionId")) {
      payload.sessionId = await validateSessionLink(
        current.ownerId,
        payload.sessionId,
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "label")) {
      payload.label = String(payload.label || "")
        .trim()
        .slice(0, 240);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "routineName")) {
      payload.routineName = String(payload.routineName || "")
        .trim()
        .slice(0, 120);
    }
    const photo = await Photo.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    res.json(serializePhoto(photo));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  let dbSession;
  let cleanupJobs = [];
  try {
    dbSession = await Photo.startSession();
    await dbSession.withTransaction(async () => {
      const current = await Photo.findById(req.params.id)
        .session(dbSession)
        .lean();
      if (!current) {
        const error = new Error("Foto no encontrada");
        error.statusCode = 404;
        throw error;
      }
      if (String(current.ownerId) !== String(req.user.id)) {
        const error = new Error("No autorizado");
        error.statusCode = 403;
        throw error;
      }
      cleanupJobs = await queuePhotoAssetCleanup(current, {
        session: dbSession,
      });
      await Photo.deleteOne({ _id: current._id }, { session: dbSession });
      await User.updateMany(
        { "profile.avatarPhotoId": String(current._id) },
        { $set: { "profile.avatarPhotoId": "" } },
        { session: dbSession },
      );
    });
    const cleanup = await processPhotoAssetCleanupJobs({
      ids: cleanupJobs.map((job) => job._id),
    });
    res.json({ ok: true, cleanupPending: cleanup.pending });
  } catch (error) {
    next(error);
  } finally {
    await dbSession?.endSession();
  }
});

export default router;
