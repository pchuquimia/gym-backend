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
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toArray(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const firstNonEmpty = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim() ||
  "";

const includesNormalized = (value, token) =>
  value
    ?.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(token);

const mergeMechanics = (incoming, current, fallback = {}) => {
  const currentValue =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    return { ...currentValue, ...incoming };
  }
  return {
    ...currentValue,
    forceType: firstNonEmpty(fallback.forceType, currentValue.forceType),
    contraction: firstNonEmpty(fallback.contraction, currentValue.contraction),
  };
};

const getExerciseMediaStructure = (exercise = {}) => ({
  category:
    exercise.category ||
    (Array.isArray(exercise.categories) ? exercise.categories[0] : "") ||
    "",
  bodyRegion: exercise.bodyRegion || "",
  primaryMuscleGroup:
    exercise.primaryMuscleGroup ||
    exercise.primaryMuscle ||
    exercise.muscle ||
    "",
  movementPattern:
    exercise.movementPattern ||
    (Array.isArray(exercise.movementPatterns)
      ? exercise.movementPatterns[0]
      : "") ||
    "",
});

const normalizePayload = (body, req, current = null) => {
  const payload = { ...body };
  const hasField = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const arrayOrCurrent = (field, fallback) =>
    hasField(field) ? toArray(payload[field]) : toArray(fallback);
  const slug = slugify(
    payload.slug ||
      payload.id ||
      payload._id ||
      payload.name ||
      current?.slug ||
      current?._id ||
      current?.name,
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
      : current?.ownerId || req.user.id;

  payload.aliases = arrayOrCurrent("aliases", current?.aliases);
  payload.categories =
    hasField("categories") && toArray(payload.categories).length
      ? toArray(payload.categories)
      : hasField("category") && toArray(payload.category).length
        ? toArray(payload.category)
        : toArray(current?.categories);
  payload.category = firstNonEmpty(
    payload.category,
    payload.categories[0],
    current?.category,
  );
  payload.bodyRegion = firstNonEmpty(payload.bodyRegion, current?.bodyRegion);
  payload.navigationRegion = firstNonEmpty(
    payload.navigationRegion,
    current?.navigationRegion,
  );

  const primaryMuscleGroup = firstNonEmpty(
    payload.primaryMuscleGroup,
    payload.primaryMuscle,
    payload.muscle,
    current?.primaryMuscleGroup,
    current?.primaryMuscle,
    current?.muscle,
  );
  payload.primaryMuscleGroup = primaryMuscleGroup;
  payload.muscle = primaryMuscleGroup;
  payload.primaryMuscle = primaryMuscleGroup;
  payload.primaryMuscles = arrayOrCurrent(
    "primaryMuscles",
    current?.primaryMuscles,
  );
  payload.secondaryMuscles = arrayOrCurrent(
    "secondaryMuscles",
    current?.secondaryMuscles,
  );
  payload.stabilizerMuscles = arrayOrCurrent(
    "stabilizerMuscles",
    current?.stabilizerMuscles,
  );
  payload.instructions = arrayOrCurrent("instructions", current?.instructions);
  payload.commonMistakes = arrayOrCurrent(
    "commonMistakes",
    current?.commonMistakes,
  );
  payload.tags = arrayOrCurrent("tags", current?.tags);
  payload.movementPatterns =
    hasField("movementPatterns") && toArray(payload.movementPatterns).length
      ? toArray(payload.movementPatterns)
      : hasField("movementPattern") && toArray(payload.movementPattern).length
        ? toArray(payload.movementPattern)
        : toArray(current?.movementPatterns);
  payload.movementPattern = firstNonEmpty(
    payload.movementPattern,
    payload.movementPatterns[0],
    current?.movementPattern,
  );
  payload.equipment = arrayOrCurrent("equipment", current?.equipment);
  payload.goals = arrayOrCurrent("goals", current?.goals);
  payload.precautions = arrayOrCurrent("precautions", current?.precautions);
  payload.exerciseType = firstNonEmpty(
    payload.exerciseType,
    current?.exerciseType,
  );
  payload.laterality = firstNonEmpty(payload.laterality, current?.laterality);
  payload.kineticChain = firstNonEmpty(
    payload.kineticChain,
    current?.kineticChain,
  );
  payload.executionType = firstNonEmpty(
    payload.executionType,
    current?.executionType,
  );
  payload.stability = firstNonEmpty(payload.stability, current?.stability);
  payload.position = firstNonEmpty(payload.position, current?.position);
  payload.difficulty = firstNonEmpty(payload.difficulty, current?.difficulty);
  payload.mechanics = mergeMechanics(payload.mechanics, current?.mechanics, {
    forceType: payload.force,
    contraction: payload.executionType,
  });
  payload.branches =
    Array.isArray(payload.branches) && payload.branches.length
      ? payload.branches
      : toArray(payload.branches).length
        ? toArray(payload.branches)
        : current?.branches?.length
          ? current.branches
          : ["general"];
  const isUnilateral =
    payload.movementMode === "unilateral" ||
    includesNormalized(payload.laterality, "unilateral");
  const supportsUnilateral = hasField("supportsUnilateral")
    ? Boolean(payload.supportsUnilateral)
    : Boolean(current?.supportsUnilateral);
  payload.supportsUnilateral = Boolean(supportsUnilateral || isUnilateral);
  payload.movementMode =
    hasField("movementMode") || hasField("laterality") || !current
      ? isUnilateral
        ? "unilateral"
        : "bilateral"
      : current?.movementMode || "bilateral";
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
      ...getExerciseMediaStructure(exercise),
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
      1000,
    );
    const fields = req.query.fields
      ? req.query.fields.split(",").join(" ")
      : "name slug aliases category categories bodyRegion navigationRegion primaryMuscleGroup muscle primaryMuscle primaryMuscles secondaryMuscles stabilizerMuscles movementPattern movementPatterns equipment exerciseType laterality kineticChain executionType stability position difficulty goals mechanics force precautions branches tags type ownerId image imagePublicId media thumb supportsUnilateral movementMode isActive updatedAt createdAt";
    const filter = {};
    const andFilters = [];
    andFilters.push({
      $or: [{ ownerId: req.user.id }, { ownerId: null }, { type: "system" }],
    });

    if (req.query.active !== "false") filter.isActive = { $ne: false };
    if (req.query.type && ["system", "custom"].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    if (req.query.muscle) {
      andFilters.push({
        $or: [
          { muscle: req.query.muscle },
          { primaryMuscle: req.query.muscle },
          { primaryMuscleGroup: req.query.muscle },
        ],
      });
    }
    if (req.query.category) {
      andFilters.push({
        $or: [
          { category: req.query.category },
          { categories: req.query.category },
        ],
      });
    }
    if (req.query.bodyRegion) {
      filter.bodyRegion = req.query.bodyRegion;
    }
    if (req.query.navigationRegion) {
      filter.navigationRegion = req.query.navigationRegion;
    }
    if (req.query.primaryMuscleGroup) {
      andFilters.push({
        $or: [
          { primaryMuscleGroup: req.query.primaryMuscleGroup },
          { primaryMuscle: req.query.primaryMuscleGroup },
          { muscle: req.query.primaryMuscleGroup },
        ],
      });
    }
    if (req.query.movementPattern) {
      andFilters.push({
        $or: [
          { movementPattern: req.query.movementPattern },
          { movementPatterns: req.query.movementPattern },
        ],
      });
    }
    if (req.query.equipment) {
      filter.equipment = req.query.equipment;
    }
    if (req.query.exerciseType) {
      filter.exerciseType = req.query.exerciseType;
    }
    if (req.query.laterality) {
      filter.laterality = req.query.laterality;
    }
    if (req.query.kineticChain) {
      filter.kineticChain = req.query.kineticChain;
    }
    if (req.query.executionType) {
      filter.executionType = req.query.executionType;
    }
    if (req.query.stability) {
      filter.stability = req.query.stability;
    }
    if (req.query.position) {
      filter.position = req.query.position;
    }
    if (req.query.difficulty) {
      filter.difficulty = req.query.difficulty;
    }
    if (req.query.goal) {
      filter.goals = req.query.goal;
    }
    if (req.query.branch && req.query.branch !== "todos") {
      filter.branches = { $in: [req.query.branch, "general"] };
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      andFilters.push({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { aliases: { $regex: q, $options: "i" } },
          { categories: { $regex: q, $options: "i" } },
          { bodyRegion: { $regex: q, $options: "i" } },
          { navigationRegion: { $regex: q, $options: "i" } },
          { primaryMuscleGroup: { $regex: q, $options: "i" } },
          { primaryMuscles: { $regex: q, $options: "i" } },
          { secondaryMuscles: { $regex: q, $options: "i" } },
          { stabilizerMuscles: { $regex: q, $options: "i" } },
          { movementPatterns: { $regex: q, $options: "i" } },
          { equipment: { $regex: q, $options: "i" } },
          { goals: { $regex: q, $options: "i" } },
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
