import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Photo from "../models/Photo.js";
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
  deletePhotoFromCloudinary,
  getPhotoDeliveryUrl,
} from "../utils/photoUpload.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// resolve to backend/uploads (one level above src)
const uploadsDir = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
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
const PHOTO_FIELDS = [
  "date",
  "label",
  "type",
  "view",
  "sessionId",
  "routineName",
];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedImageTypes.has(file.mimetype)) return cb(null, true);
    const error = new Error("Solo se permiten imagenes JPG, PNG o WebP");
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

const normalizeDate = (value) => {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : candidate;
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

const serializePhoto = (photo) => {
  const value = photo?.toObject?.() || photo || {};
  const {
    url: _url,
    publicId: _publicId,
    deliveryType: _deliveryType,
    ...safe
  } = value;
  const id = String(value._id || value.id || "");
  return {
    ...safe,
    _id: value._id,
    contentUrl: id ? `/api/photos/${id}/content` : "",
  };
};

const requestedOwnerId = async (req) => {
  const ownerId = String(
    req.body?.ownerId || req.query?.athleteId || req.user.id,
  );
  if (!(await ensureCanAccessOwner(req, ownerId))) {
    const error = new Error("No autorizado para administrar estas fotos");
    error.statusCode = 403;
    throw error;
  }
  return ownerId;
};

router.get("/summary", async (req, res, next) => {
  try {
    const filter = await getAccessibleOwnerFilter(req, {});
    const [result] = await Photo.aggregate([
      { $match: filter },
      { $match: { type: { $ne: "profile" } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          gym: { $sum: { $cond: [{ $eq: ["$type", "gym"] }, 1, 0] } },
          home: { $sum: { $cond: [{ $eq: ["$type", "home"] }, 1, 0] } },
          lastDate: { $max: "$date" },
        },
      },
    ]);
    res.set("Cache-Control", "private, no-store");
    res.json(result || { total: 0, gym: 0, home: 0, lastDate: null });
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
    else if (req.query.includeProfile !== "true")
      baseFilter.type = { $ne: "profile" };
    if (allowedPhotoViews.has(req.query.view)) baseFilter.view = req.query.view;
    const filter = await getAccessibleOwnerFilter(req, baseFilter);
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
  } catch (err) {
    next(err);
  }
});

router.get("/:id/content", async (req, res, next) => {
  try {
    const photo = await Photo.findById(req.params.id).lean();
    if (!photo) return res.status(404).json({ error: "Foto no encontrada" });
    if (!(await ensureCanAccessOwner(req, photo.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const width = Math.min(
      Math.max(parseInt(req.query.width, 10) || 1600, 160),
      2000,
    );
    const height = Math.min(
      Math.max(parseInt(req.query.height, 10) || 1600, 160),
      2000,
    );
    if (!photo.publicId && photo.url?.includes("/uploads/")) {
      const filename = path.basename(new URL(photo.url).pathname);
      return res.sendFile(path.join(uploadsDir, filename));
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
      return res.status(502).json({ error: "No se pudo recuperar la imagen" });
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = await requestedOwnerId(req);
    const date = normalizeDate(req.body.date);
    if (!date) return res.status(400).json({ error: "Fecha inválida" });
    const url = parseAllowedLegacyUrl(req.body.url, req);
    if (!url) {
      return res.status(400).json({
        error: "La foto debe subirse como archivo o usar una URL permitida",
      });
    }
    const photo = await Photo.create({
      date,
      label: String(req.body.label || "")
        .trim()
        .slice(0, 240),
      url,
      type: allowedPhotoTypes.has(req.body.type) ? req.body.type : "gym",
      view: allowedPhotoViews.has(req.body.view) ? req.body.view : "front",
      sessionId: req.body.sessionId || null,
      routineName: String(req.body.routineName || "")
        .trim()
        .slice(0, 120),
      ownerId,
    });
    res.status(201).json(serializePhoto(photo));
  } catch (err) {
    next(err);
  }
});

router.post("/upload", receivePhoto, async (req, res, next) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Selecciona una imagen" });
    const { label, type, sessionId, routineName } = req.body;
    const ownerId = await requestedOwnerId(req);
    const date =
      normalizeDate(req.body.date) || new Date().toLocaleDateString("en-CA");
    const photoType = allowedPhotoTypes.has(type) ? type : "gym";
    const photoView = allowedPhotoViews.has(req.body.view)
      ? req.body.view
      : "front";
    const baseUrl =
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    let uploaded = null;

    if (isCloudinaryReady) {
      try {
        uploaded = await uploadPhotoToCloudinary(req.file.path);
      } catch (err) {
        console.error("Cloudinary upload failed", err);
        await removeLocalFile(req.file.path);
        return res.status(500).json({ error: "No se pudo subir la imagen" });
      }
    }

    if (uploaded) await removeLocalFile(req.file.path);

    const url = uploaded?.url || `${baseUrl}/uploads/${req.file.filename}`;
    const photo = await Photo.create({
      date: date || new Date().toISOString().slice(0, 10),
      label: label || "",
      type: photoType,
      sessionId: sessionId || null,
      url,
      publicId: uploaded?.publicId || "",
      deliveryType: uploaded?.deliveryType || "upload",
      ownerId,
      view: photoView,
      routineName: String(routineName || "")
        .trim()
        .slice(0, 120),
    });
    res.status(201).json(serializePhoto(photo));
  } catch (err) {
    await removeLocalFile(req.file?.path);
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await Photo.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const payload = {};
    PHOTO_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field))
        payload[field] = req.body[field];
    });
    if (Object.prototype.hasOwnProperty.call(payload, "date")) {
      payload.date = normalizeDate(payload.date);
      if (!payload.date)
        return res.status(400).json({ error: "Fecha inválida" });
    }
    if (Object.prototype.hasOwnProperty.call(payload, "type")) {
      if (!allowedPhotoTypes.has(payload.type)) delete payload.type;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "view")) {
      if (!allowedPhotoViews.has(payload.view)) delete payload.view;
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
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Photo.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Not found" });
    if (!(await ensureCanAccessOwner(req, current.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (current.publicId) {
      await deletePhotoFromCloudinary(
        current.publicId,
        current.deliveryType || "upload",
      );
    } else if (current.url?.includes("/uploads/")) {
      const filename = path.basename(new URL(current.url).pathname);
      await removeLocalFile(path.join(uploadsDir, filename));
    }
    await Photo.findByIdAndDelete(req.params.id);
    await User.updateMany(
      { "profile.avatarPhotoId": String(current._id) },
      { $set: { "profile.avatarPhotoId": "" } },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
