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

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEARCH_SYNONYMS = new Map([
  ["press banca", "bench press"],
  ["press de banca", "bench press"],
  ["jalon", "pulldown"],
  ["dominada", "pull-up"],
  ["dominadas", "pull-up"],
  ["remo", "row"],
  ["sentadilla", "squat"],
  ["peso muerto", "deadlift"],
  ["zancada", "lunge"],
  ["flexiones", "push-up"],
  ["flexion", "push-up"],
  ["elevacion lateral", "lateral raise"],
  ["curl de biceps", "biceps curl"],
]);

const expandSearchTerms = (value = "") => {
  const term = String(value).trim();
  if (!term) return [];
  const normalized = term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return Array.from(
    new Set([term, SEARCH_SYNONYMS.get(normalized)].filter(Boolean)),
  );
};

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
  const stringOrCurrent = (field, fallback) =>
    hasField(field) ? String(payload[field] || "").trim() : fallback || "";
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
  payload.ownerId = type === "system" ? null : current?.ownerId || req.user.id;

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
  payload.movementPatterns = hasField("movementPatterns")
    ? toArray(payload.movementPatterns)
    : hasField("movementPattern")
      ? toArray(payload.movementPattern)
      : toArray(current?.movementPatterns);
  payload.movementPattern = hasField("movementPattern")
    ? firstNonEmpty(payload.movementPattern, payload.movementPatterns[0])
    : firstNonEmpty(payload.movementPatterns[0], current?.movementPattern);
  payload.equipment = arrayOrCurrent("equipment", current?.equipment);
  payload.goals = arrayOrCurrent("goals", current?.goals);
  payload.precautions = arrayOrCurrent("precautions", current?.precautions);
  payload.exerciseType = stringOrCurrent("exerciseType", current?.exerciseType);
  payload.laterality = stringOrCurrent("laterality", current?.laterality);
  payload.kineticChain = stringOrCurrent("kineticChain", current?.kineticChain);
  payload.executionType = stringOrCurrent(
    "executionType",
    current?.executionType,
  );
  payload.stability = stringOrCurrent("stability", current?.stability);
  payload.position = stringOrCurrent("position", current?.position);
  payload.difficulty = stringOrCurrent("difficulty", current?.difficulty);
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

const getVisibleExerciseScope = async (req) => {
  const requestedOwnerId = String(req.query.ownerId || req.user.id).trim();
  if (
    requestedOwnerId !== req.user.id &&
    !(await ensureCanAccessOwner(req, requestedOwnerId))
  ) {
    return null;
  }
  const ownerIds = [
    ...new Set([req.user.id, requestedOwnerId].filter(Boolean)),
  ];
  return {
    $or: [
      { ownerId: { $in: ownerIds }, type: "custom" },
      { ownerId: null },
      { type: "system" },
    ],
  };
};

const blockManagedAthleteWrites = (req, res, next) => {
  if (
    req.user.role === "Cliente" &&
    req.user.trainingMode === "coach_managed"
  ) {
    return res.status(403).json({
      error: "Tu coach administra los ejercicios y la planificación",
    });
  }
  next();
};

router.post(
  "/:id/media",
  blockManagedAthleteWrites,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const exercise = await Exercise.findById(req.params.id);
      if (!exercise)
        return res.status(404).json({ error: "Exercise not found" });
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
        [kind === "thumbnail"
          ? "thumbnail"
          : kind === "animation"
            ? "animation"
            : kind === "video"
              ? "video"
              : "image"]: asset,
      };
      exercise.media = media;
      if (kind === "main" || kind === "image" || kind === "thumbnail") {
        exercise.image = asset.url;
        exercise.imagePublicId = asset.publicId;
      }
      exercise.updatedBy = req.user.id;
      await exercise.save();

      res.json(exercise);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/facets", async (req, res, next) => {
  try {
    const scope = await getVisibleExerciseScope(req);
    if (!scope) return res.status(403).json({ error: "No autorizado" });
    const filter = {
      isActive: { $ne: false },
      ...scope,
    };
    const exercises = await Exercise.find(
      filter,
      "category categories bodyRegion primaryMuscleGroup primaryMuscle muscle equipment movementPattern movementPatterns difficulty exerciseType position goals",
    )
      .maxTimeMS(10000)
      .lean();

    const counts = (values) =>
      Object.entries(
        values.reduce((result, value) => {
          if (value) result[value] = (result[value] || 0) + 1;
          return result;
        }, {}),
      )
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "es"));
    const flat = (value) =>
      (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
    const primaryGroup = (exercise) =>
      exercise.primaryMuscleGroup ||
      exercise.primaryMuscle ||
      exercise.muscle ||
      "";
    const groupsByRegion = exercises.reduce((result, exercise) => {
      const region = exercise.bodyRegion || "";
      const group = primaryGroup(exercise);
      if (!region || !group) return result;
      result[region] ||= [];
      result[region].push(group);
      return result;
    }, {});
    Object.keys(groupsByRegion).forEach((region) => {
      groupsByRegion[region] = counts(groupsByRegion[region]);
    });

    const isCardio = (exercise) =>
      flat(exercise.categories).includes("Cardio") ||
      exercise.category === "Cardio";
    const entryCounts = {
      upper: exercises.filter((item) => item.bodyRegion === "Tren superior")
        .length,
      lower: exercises.filter((item) => item.bodyRegion === "Tren inferior")
        .length,
      core: exercises.filter((item) => item.bodyRegion === "Zona media").length,
      fullBody: exercises.filter(
        (item) => item.bodyRegion === "Cuerpo completo" && !isCardio(item),
      ).length,
      cardio: exercises.filter(isCardio).length,
    };

    res.set("Cache-Control", "private, no-store");
    res.json({
      total: exercises.length,
      categories: counts(
        exercises.flatMap((item) =>
          flat(item.categories).length
            ? flat(item.categories)
            : flat(item.category),
        ),
      ),
      bodyRegions: counts(exercises.map((item) => item.bodyRegion)),
      groupsByRegion,
      equipment: counts(exercises.flatMap((item) => flat(item.equipment))),
      movementPatterns: counts(
        exercises.flatMap((item) =>
          flat(item.movementPatterns).length
            ? flat(item.movementPatterns)
            : flat(item.movementPattern),
        ),
      ),
      difficulties: counts(exercises.map((item) => item.difficulty)),
      exerciseTypes: counts(exercises.map((item) => item.exerciseType)),
      positions: counts(exercises.map((item) => item.position)),
      goals: counts(exercises.flatMap((item) => flat(item.goals))),
      entryCounts,
    });
  } catch (error) {
    next(error);
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
      : "name slug aliases category categories bodyRegion navigationRegion primaryMuscleGroup muscle primaryMuscle primaryMuscles secondaryMuscles stabilizerMuscles movementPattern movementPatterns equipment exerciseType laterality kineticChain executionType stability position difficulty goals mechanics force precautions branches tags type ownerId image imagePublicId media thumb supportsUnilateral movementMode source classificationStatus isActive updatedAt createdAt";
    const filter = {};
    const andFilters = [];
    const scope = await getVisibleExerciseScope(req);
    if (!scope) return res.status(403).json({ error: "No autorizado" });
    andFilters.push(scope);

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
    if (req.query.excludeCategory) {
      andFilters.push({
        $nor: [
          { category: req.query.excludeCategory },
          { categories: req.query.excludeCategory },
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
      const terms = expandSearchTerms(req.query.q).map(escapeRegex);
      const searchableFields = [
        "name",
        "aliases",
        "categories",
        "bodyRegion",
        "navigationRegion",
        "primaryMuscleGroup",
        "primaryMuscles",
        "secondaryMuscles",
        "stabilizerMuscles",
        "movementPatterns",
        "equipment",
        "goals",
        "tags",
        "muscle",
        "primaryMuscle",
      ];
      andFilters.push({
        $or: terms.flatMap((term) =>
          searchableFields.map((field) => ({
            [field]: { $regex: term, $options: "i" },
          })),
        ),
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
    res.set("Cache-Control", "private, no-store");
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

router.post("/", blockManagedAthleteWrites, async (req, res, next) => {
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

router.put("/:id", blockManagedAthleteWrites, async (req, res, next) => {
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

router.delete("/:id", blockManagedAthleteWrites, async (req, res, next) => {
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
