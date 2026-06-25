import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Photo from "../models/Photo.js";
import {
  ensureCanAccessOwner,
  getAccessibleOwnerFilter,
  protect,
} from "../middleware/authMiddleware.js";
import {
  uploadPhotoToCloudinary,
  removeLocalFile,
  isCloudinaryReady,
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
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const upload = multer({ storage });

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { type } = req.query;
    const filter = await getAccessibleOwnerFilter(req, type ? { type } : {});
    const photos = await Photo.find(filter).lean();
    res.json(photos);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const ownerId = req.body.ownerId || req.user.id;
    if (!(await ensureCanAccessOwner(req, ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const photo = await Photo.create({ ...req.body, ownerId });
    res.status(201).json(photo);
  } catch (err) {
    next(err);
  }
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { date, label, type, sessionId } = req.body;
    const baseUrl =
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    let uploaded = null;

    if (isCloudinaryReady) {
      try {
        uploaded = await uploadPhotoToCloudinary(req.file.path);
      } catch (err) {
        console.error("Cloudinary upload failed", err);
        return res.status(500).json({ error: "Cloudinary upload failed" });
      }
    }

    if (uploaded) await removeLocalFile(req.file.path);

    const url = uploaded?.url || `${baseUrl}/uploads/${req.file.filename}`;
    const photo = await Photo.create({
      date: date || new Date().toISOString().slice(0, 10),
      label: label || "",
      type: type || "gym",
      sessionId: sessionId || null,
      ownerId: req.user.id,
      url,
      publicId: uploaded?.publicId || "",
    });
    res.status(201).json(photo);
  } catch (err) {
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
    const payload = { ...req.body, ownerId: current.ownerId || req.user.id };
    if (req.body.ownerId && req.user.role === "Admin") {
      payload.ownerId = req.body.ownerId;
    }
    const photo = await Photo.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    res.json(photo);
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
    await Photo.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
