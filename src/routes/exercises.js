import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import multer from "multer";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import Exercise from "../models/Exercise.js";
import {
  removeLocalFile,
  uploadExerciseMedia,
} from "../utils/exerciseMediaUpload.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(
      file.originalname,
    )}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      return cb(new Error("Solo se permiten imagenes"));
    }
    cb(null, true);
  },
});

const slugify = (text = "") =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const cloudinaryPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("res.cloudinary.com")) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return "";
    let rest = parts.slice(uploadIndex + 1);
    if (rest[0]?.startsWith("v") && /^\d+$/.test(rest[0].slice(1))) {
      rest = rest.slice(1);
    }
    if (rest[0] && rest[0].includes(",")) {
      rest = rest.slice(1);
    }
    const filename = rest.join("/");
    return filename.replace(/\.[^.]+$/, "");
  } catch {
    return "";
  }
};

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizePayload = (body, req, current = null) => {
  const payload = { ...body };
  const slug = slugify(
    payload.slug || payload.id || payload._id || payload.name,
  );
  const requestedType = payload.type === "system" ? "system" : "custom";
  const type = req.user.role === "Admin" ? requestedType : "custom";

  payload.slug = slug;
  payload._id = current?._id || payload._id || payload.id || slug;
  delete payload.id;

  payload.type = type;
  payload.ownerId =
    type === "system"
      ? null
      : req.user.role === "Admin" && payload.ownerId
        ? payload.ownerId
        : current?.ownerId || req.user.id;

  payload.muscle =
    payload.muscle || payload.primaryMuscle || current?.muscle || "";
  payload.primaryMuscle =
    payload.primaryMuscle || payload.muscle || current?.primaryMuscle || "";
  payload.secondaryMuscles = toArray(payload.secondaryMuscles);
  payload.instructions = toArray(payload.instructions);
  payload.commonMistakes = toArray(payload.commonMistakes);
  payload.tags = toArray(payload.tags);
  payload.branches =
    Array.isArray(payload.branches) && payload.branches.length
      ? payload.branches
      : toArray(payload.branches).length
        ? toArray(payload.branches)
        : current?.branches?.length
          ? current.branches
          : ["general"];
  payload.supportsUnilateral = Boolean(payload.supportsUnilateral);
  payload.movementMode =
    payload.movementMode === "unilateral" ? "unilateral" : "bilateral";
  payload.isActive =
    typeof payload.isActive === "boolean"
      ? payload.isActive
      : (current?.isActive ?? true);
  payload.version = Number(payload.version || current?.version || 1);
  payload.updatedBy = req.user.id;
  if (!current) payload.createdBy = req.user.id;

  if (!payload.imagePublicId && payload.image) {
    const publicId = cloudinaryPublicIdFromUrl(payload.image);
    if (publicId) payload.imagePublicId = publicId;
  }
  if (payload.image || payload.imagePublicId) {
    payload.media = {
      ...(current?.media || {}),
      image: {
        ...(current?.media?.image || {}),
        url: payload.image || current?.media?.image?.url || "",
        publicId:
          payload.imagePublicId || current?.media?.image?.publicId || "",
      },
    };
  }
  return payload;
};

const assertCanManageExercise = async (req, exercise) => {
  if (!exercise) return false;
  if (exercise.type === "system") return req.user.role === "Admin";
  if (!exercise.ownerId) return req.user.role === "Admin";
  return ensureCanAccessOwner(req, exercise.ownerId);
};

router.use(protect);

router.post("/:id/media", upload.single("file"), async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
    if (!(await assertCanManageExercise(req, exercise))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const kind = req.body.kind || "main";
    const uploaded = await uploadExerciseMedia(req.file.path, {
      type: exercise.type,
      ownerId: exercise.ownerId,
      slug: exercise.slug || exercise._id,
      kind,
    });
    const baseUrl =
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const fallback = {
      url: `${baseUrl}/uploads/${req.file.filename}`,
      publicId: "",
      width: null,
      height: null,
      format: "",
      bytes: req.file.size || null,
    };
    const asset = uploaded || fallback;
    if (uploaded) await removeLocalFile(req.file.path);

    const media = {
      ...(exercise.media?.toObject?.() || exercise.media || {}),
      image: asset,
    };
    exercise.media = media;
    exercise.image = asset.url;
    exercise.imagePublicId = asset.publicId;
    exercise.updatedBy = req.user.id;
    await exercise.save();

    res.json(exercise);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id).lean();
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
    const isSystem = !exercise.ownerId || exercise.type === "system";
    if (!isSystem && !(await ensureCanAccessOwner(req, exercise.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    res.json(exercise);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );
    const fields = req.query.fields
      ? req.query.fields.split(",").join(" ")
      : "name slug muscle primaryMuscle secondaryMuscles equipment branches tags type ownerId image imagePublicId media thumb supportsUnilateral movementMode isActive updatedAt createdAt";
    const filter = {};
    const andFilters = [];
    if (req.user.role !== "Admin") {
      andFilters.push({
        $or: [{ ownerId: req.user.id }, { ownerId: null }, { type: "system" }],
      });
    }

    if (req.query.active !== "false") filter.isActive = { $ne: false };
    if (req.query.type && ["system", "custom"].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    if (req.query.muscle) {
      andFilters.push({
        $or: [
          { muscle: req.query.muscle },
          { primaryMuscle: req.query.muscle },
        ],
      });
    }
    if (req.query.branch && req.query.branch !== "todos") {
      filter.branches = { $in: [req.query.branch, "general"] };
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      andFilters.push({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { tags: { $regex: q, $options: "i" } },
          { muscle: { $regex: q, $options: "i" } },
          { primaryMuscle: { $regex: q, $options: "i" } },
        ],
      });
    }
    if (andFilters.length) filter.$and = andFilters;

    const exercises = await Exercise.find(filter, fields)
      .sort({ type: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(10000)
      .lean();

    const includeMeta = req.query.meta === "true";
    res.set("Cache-Control", "private, max-age=120");
    if (includeMeta) {
      const total = await Exercise.countDocuments(filter);
      res.json({
        page,
        limit,
        count: exercises.length,
        total,
        items: exercises,
      });
    } else {
      res.json(exercises);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = normalizePayload(req.body, req);
    if (payload.type === "system" && req.user.role !== "Admin") {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (
      payload.type === "custom" &&
      !(await ensureCanAccessOwner(req, payload.ownerId))
    ) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const existing = await Exercise.exists({ _id: payload._id });
    if (existing && payload.type === "system") {
      return res.status(409).json({ error: "El ejercicio ya existe" });
    }
    if (existing && payload.type === "custom") {
      payload._id = `${payload.slug}-${String(payload.ownerId).slice(-6)}-${Date.now()}`;
    }
    const exercise = await Exercise.create(payload);
    res.status(201).json(exercise);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await Exercise.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Exercise not found" });
    if (!(await assertCanManageExercise(req, current))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const payload = normalizePayload(req.body, req, current);
    if (current.type === "system" && req.user.role !== "Admin") {
      return res.status(403).json({ error: "No autorizado" });
    }
    const exercise = await Exercise.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    res.json(exercise);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await Exercise.findById(req.params.id);
    if (!current) return res.status(404).json({ error: "Exercise not found" });
    if (!(await assertCanManageExercise(req, current))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (current.type === "system") {
      current.isActive = false;
      current.updatedBy = req.user.id;
      await current.save();
      return res.json({ ok: true, softDeleted: true });
    }
    await Exercise.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
