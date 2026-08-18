import fs from "fs";
import crypto from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import {
  authorizeRoles,
  ensureCanAccessOwner,
  protect,
} from "../middleware/authMiddleware.js";
import Exercise from "../models/Exercise.js";
import Routine from "../models/Routine.js";
import {
  removeLocalFile,
  uploadExerciseMedia,
} from "../utils/exerciseMediaUpload.js";
import {
  getExerciseLanguage,
  localizeExerciseDocument,
  translateExerciseNameToSpanish,
} from "../utils/exerciseLocalization.js";
import {
  buildExerciseIdentityKey,
  canonicalizeBodyRegion,
  canonicalizeCategory,
  canonicalizeEquipment,
  canonicalizeMovementPattern,
  canonicalizeMuscleGroup,
  classifyExerciseTaxonomy,
} from "../utils/exerciseTaxonomy.js";
import {
  deleteLegacyExercise,
  listExerciseMigrationCandidates,
  migrateExercise,
} from "../services/exerciseMigrationService.js";
import {
  generateExerciseAiImage,
  getExerciseAiImageStatus,
} from "../services/exerciseAiImageService.js";
import { inferWeightConfig } from "../utils/weightConfig.js";
import { loadInConcurrentPages } from "../utils/concurrentPagination.js";
import { measureDatabase } from "../middleware/performanceTiming.js";

const router = Router();
const EXERCISE_FACET_PAGE_SIZE = 200;
const EXERCISE_FACET_CONCURRENCY = 8;
const EXERCISE_FACET_CACHE_TTL_MS = 5 * 60 * 1000;
const EXERCISE_FACET_CACHE_MAX_ENTRIES = 8;
const EXERCISE_LIST_CACHE_TTL_MS = 2 * 60 * 1000;
const EXERCISE_LIST_CACHE_MAX_ENTRIES = 64;
const EXERCISE_FACET_FIELDS =
  "category categories bodyRegion primaryMuscleGroup primaryMuscle muscle equipment movementPattern movementPatterns difficulty exerciseType position goals image imagePublicId media.image type ownerId";
const exerciseFacetCache = new Map();
const exerciseListCache = new Map();
let systemCatalogVersionCache = null;
const SYSTEM_CATALOG_FILTER = {
  isActive: { $ne: false },
  $or: [{ type: "system" }, { ownerId: null }, { ownerId: { $exists: false } }],
};
const VERSIONED_CATALOG_FIELDS =
  "name localizedNames nameSpanish nameEnglish slug aliases category categories bodyRegion navigationRegion primaryMuscleGroup muscle primaryMuscle primaryMuscles secondaryMuscles stabilizerMuscles movementPattern movementPatterns equipment loadType weightConfig exerciseType laterality difficulty goals tags branches type ownerId image imagePublicId media.image media.thumbnail thumb supportsUnilateral movementMode isActive updatedAt";

const clearExerciseFacetCache = () => {
  exerciseFacetCache.clear();
  exerciseListCache.clear();
  systemCatalogVersionCache = null;
};

const getSystemCatalogVersion = async () => {
  if (
    systemCatalogVersionCache &&
    systemCatalogVersionCache.expiresAt > Date.now()
  ) {
    return systemCatalogVersionCache.value;
  }
  const [count, latest] = await Promise.all([
    Exercise.countDocuments(SYSTEM_CATALOG_FILTER),
    Exercise.findOne(SYSTEM_CATALOG_FILTER, "updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);
  const source = `${count}:${latest?.updatedAt?.toISOString?.() || "initial"}`;
  const value = {
    version: crypto
      .createHash("sha1")
      .update(source)
      .digest("hex")
      .slice(0, 16),
    count,
    updatedAt: latest?.updatedAt || null,
  };
  systemCatalogVersionCache = {
    value,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  return value;
};

const readExerciseListCache = (key) => {
  const cached = exerciseListCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) exerciseListCache.delete(key);
    return null;
  }
  exerciseListCache.delete(key);
  exerciseListCache.set(key, cached);
  return cached.value;
};

const writeExerciseListCache = (key, value) => {
  exerciseListCache.set(key, {
    value,
    expiresAt: Date.now() + EXERCISE_LIST_CACHE_TTL_MS,
  });
  while (exerciseListCache.size > EXERCISE_LIST_CACHE_MAX_ENTRIES) {
    exerciseListCache.delete(exerciseListCache.keys().next().value);
  }
};

const loadExerciseFacetDocuments = async (filter) => {
  return loadInConcurrentPages({
    pageSize: EXERCISE_FACET_PAGE_SIZE,
    concurrency: EXERCISE_FACET_CONCURRENCY,
    fetchPage: ({ skip, limit }) =>
      Exercise.find(filter, EXERCISE_FACET_FIELDS)
        .sort({ _id: 1 })
        .skip(skip)
        .limit(limit)
        .batchSize(limit)
        .maxTimeMS(10000)
        .lean(),
  });
};

const loadVersionedSystemCatalog = (fields) =>
  loadInConcurrentPages({
    pageSize: 300,
    concurrency: 6,
    fetchPage: ({ skip, limit }) =>
      Exercise.find(SYSTEM_CATALOG_FILTER, fields)
        .sort({ _id: 1 })
        .skip(skip)
        .limit(limit)
        .batchSize(limit)
        .maxTimeMS(10000)
        .lean(),
  });

const loadCachedExerciseFacetDocuments = async (cacheKey, filter) => {
  const cached = exerciseFacetCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    exerciseFacetCache.delete(cacheKey);
    exerciseFacetCache.set(cacheKey, cached);
    return cached.value || cached.promise;
  }
  if (cached) exerciseFacetCache.delete(cacheKey);

  const promise = loadExerciseFacetDocuments(filter);
  exerciseFacetCache.set(cacheKey, {
    expiresAt: Date.now() + EXERCISE_FACET_CACHE_TTL_MS,
    promise,
  });
  while (exerciseFacetCache.size > EXERCISE_FACET_CACHE_MAX_ENTRIES) {
    exerciseFacetCache.delete(exerciseFacetCache.keys().next().value);
  }

  try {
    const value = await promise;
    exerciseFacetCache.set(cacheKey, {
      expiresAt: Date.now() + EXERCISE_FACET_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch (error) {
    exerciseFacetCache.delete(cacheKey);
    throw error;
  }
};

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

const aiImageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Alcanzaste el limite temporal de generaciones. Intenta mas tarde.",
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

const SEARCH_CHARACTER_PATTERNS = {
  a: "[aáàäâã]",
  e: "[eéèëê]",
  i: "[iíìïî]",
  n: "[nñ]",
  o: "[oóòöôõ]",
  u: "[uúùüû]",
};

const buildAccentInsensitivePattern = (value = "") => {
  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return Array.from(normalized)
    .map((character) => {
      if (/\s/.test(character)) return "\\s+";
      return SEARCH_CHARACTER_PATTERNS[character] || escapeRegex(character);
    })
    .join("");
};

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
    new Set(
      [term, normalized, SEARCH_SYNONYMS.get(normalized)].filter(Boolean),
    ),
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

  const language = getExerciseLanguage(req);
  const incomingName = String(payload.name || current?.name || "").trim();
  const currentNames = current?.localizedNames || {};
  const incomingNames =
    payload.localizedNames && typeof payload.localizedNames === "object"
      ? payload.localizedNames
      : {};
  const englishName = String(
    incomingNames.en ||
      (language === "en" ? incomingName : "") ||
      currentNames.en ||
      current?.name ||
      incomingName,
  ).trim();
  const spanishName = String(
    incomingNames.es ||
      (language === "es" ? incomingName : "") ||
      currentNames.es ||
      translateExerciseNameToSpanish(englishName),
  ).trim();
  payload.localizedNames = { es: spanishName, en: englishName };
  payload.name = englishName || spanishName;

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
  Object.assign(payload, classifyExerciseTaxonomy(payload));
  payload.identityKey = buildExerciseIdentityKey(payload);
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
  payload.weightConfig = inferWeightConfig({
    ...payload,
    weightConfig: hasField("weightConfig")
      ? payload.weightConfig
      : current?.weightConfig,
  });
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

router.get("/catalog/version", async (_req, res, next) => {
  try {
    const catalog = await getSystemCatalogVersion();
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.set("X-Catalog-Version", catalog.version);
    res.json({ ...catalog, schemaVersion: 1 });
  } catch (error) {
    next(error);
  }
});

router.get("/catalog/system", async (req, res, next) => {
  try {
    const catalog = await getSystemCatalogVersion();
    const language = req.query.language === "en" ? "en" : "es";
    const fields = req.query.fields
      ? String(req.query.fields).split(",").join(" ")
      : VERSIONED_CATALOG_FIELDS;
    const etag = `"catalog-${catalog.version}-${crypto
      .createHash("sha1")
      .update(`${language}:${fields}`)
      .digest("hex")
      .slice(0, 10)}"`;
    const normalizeEtag = (value) =>
      String(value || "")
        .replace(/^W\//, "")
        .replace(/^"|"$/g, "");
    if (
      normalizeEtag(req.headers["if-none-match"]) === normalizeEtag(etag)
    ) {
      return res.status(304).end();
    }
    const exercises = await measureDatabase(res, () =>
      loadVersionedSystemCatalog(fields),
    );
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.set("ETag", etag);
    res.set("X-Catalog-Version", catalog.version);
    res.json({
      version: catalog.version,
      count: exercises.length,
      items: exercises.map((exercise) =>
        localizeExerciseDocument(exercise, language),
      ),
    });
  } catch (error) {
    next(error);
  }
});

router.use(protect);

router.get("/catalog/custom", async (req, res, next) => {
  try {
    const ownerId = String(req.query.ownerId || req.user.id).trim();
    if (!(await ensureCanAccessOwner(req, ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const fields = req.query.fields
      ? String(req.query.fields).split(",").join(" ")
      : VERSIONED_CATALOG_FIELDS;
    const exercises = await measureDatabase(res, () =>
      Exercise.find(
        { ownerId, type: "custom", isActive: { $ne: false } },
        fields,
      )
        .sort({ updatedAt: -1, _id: 1 })
        .lean(),
    );
    const versionSource = exercises
      .map((exercise) => `${exercise._id}:${exercise.updatedAt || ""}`)
      .join("|");
    const version = crypto
      .createHash("sha1")
      .update(versionSource || "empty")
      .digest("hex")
      .slice(0, 16);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Catalog-Version", version);
    res.json({
      version,
      count: exercises.length,
      items: exercises.map((exercise) =>
        localizeExerciseDocument(exercise, getExerciseLanguage(req)),
      ),
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/admin/migrations",
  authorizeRoles("Admin"),
  async (_req, res, next) => {
    try {
      res.set("Cache-Control", "private, no-store");
      res.json(await listExerciseMigrationCandidates());
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/migrations",
  authorizeRoles("Admin"),
  async (req, res, next) => {
    try {
      const result = await migrateExercise({
        legacyExerciseId: String(req.body.legacyExerciseId || "").trim(),
        targetExerciseId: String(req.body.targetExerciseId || "").trim(),
        deleteLegacy: req.body.deleteLegacy !== false,
        performedBy: req.user.id,
      });
      clearExerciseFacetCache();
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/admin/legacy/:id",
  authorizeRoles("Admin"),
  async (req, res, next) => {
    try {
      const result = await deleteLegacyExercise({
        exerciseId: String(req.params.id || "").trim(),
        performedBy: req.user.id,
      });
      clearExerciseFacetCache();
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/admin/ai-image/status", authorizeRoles("Admin"), (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(getExerciseAiImageStatus());
});

router.post(
  "/admin/:id/ai-image",
  authorizeRoles("Admin"),
  aiImageLimiter,
  async (req, res, next) => {
    try {
      const exercise = await Exercise.findById(req.params.id).lean();
      if (!exercise) {
        return res.status(404).json({ error: "Ejercicio no encontrado" });
      }
      const result = await generateExerciseAiImage({
        exercise,
        prompt: req.body.prompt,
        userId: req.user.id,
      });
      clearExerciseFacetCache();
      res.set("Cache-Control", "private, no-store");
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/:id/image",
  authorizeRoles("Admin"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const exercise = await Exercise.findById(req.params.id);
      if (!exercise) {
        return res.status(404).json({ error: "Ejercicio no encontrado" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "Selecciona una imagen" });
      }

      const currentPublicId =
        exercise.media?.image?.publicId ||
        exercise.imagePublicId ||
        cloudinaryPublicIdFromUrl(exercise.media?.image?.url || exercise.image);
      const uploaded = await uploadExerciseMedia(req.file.path, {
        type: exercise.type,
        ownerId: exercise.ownerId,
        slug: exercise._id,
        ...getExerciseMediaStructure(exercise),
        kind: "main",
        publicId: currentPublicId || undefined,
      });

      if (!uploaded) {
        return res.status(503).json({
          error: "Cloudinary no esta configurado para reemplazar imagenes",
        });
      }

      const currentMedia = exercise.media?.toObject?.() || exercise.media || {};
      exercise.media = {
        ...currentMedia,
        image: uploaded,
      };
      exercise.image = uploaded.url;
      exercise.imagePublicId = uploaded.publicId;
      exercise.updatedBy = req.user.id;
      await exercise.save();

      await Routine.updateMany(
        { "exercises.exerciseId": exercise._id },
        {
          $set: {
            "exercises.$[exercise].image": uploaded.url,
            "exercises.$[exercise].imagePublicId": uploaded.publicId,
          },
        },
        { arrayFilters: [{ "exercise.exerciseId": exercise._id }] },
      );
      await Routine.updateMany(
        { "exercises.alternatives.exerciseId": exercise._id },
        {
          $set: {
            "exercises.$[].alternatives.$[alternative].image": uploaded.url,
            "exercises.$[].alternatives.$[alternative].imagePublicId":
              uploaded.publicId,
          },
        },
        { arrayFilters: [{ "alternative.exerciseId": exercise._id }] },
      );

      clearExerciseFacetCache();
      res.set("Cache-Control", "private, no-store");
      res.json({
        exercise: localizeExerciseDocument(exercise, getExerciseLanguage(req)),
        asset: uploaded,
      });
    } catch (error) {
      next(error);
    } finally {
      await removeLocalFile(req.file?.path);
    }
  },
);

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

      clearExerciseFacetCache();
      res.json(localizeExerciseDocument(exercise, getExerciseLanguage(req)));
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
    const exercises = await loadCachedExerciseFacetDocuments(
      JSON.stringify(scope),
      filter,
    );

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
      canonicalizeMuscleGroup(
        exercise.primaryMuscleGroup ||
          exercise.primaryMuscle ||
          exercise.muscle ||
          "",
      );
    const groupsByRegion = exercises.reduce((result, exercise) => {
      const region = canonicalizeBodyRegion(exercise.bodyRegion || "");
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
    const hasPreview = (exercise) =>
      Boolean(
        exercise.media?.image?.url ||
        exercise.media?.image?.publicId ||
        exercise.image ||
        exercise.imagePublicId,
      );
    const previewFrom = (items) => {
      const exercise = items.find(hasPreview);
      if (!exercise) return null;
      return {
        image: exercise.image || "",
        imagePublicId: exercise.imagePublicId || "",
        media: { image: exercise.media?.image || null },
      };
    };
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
      mobility: exercises.filter(
        (item) =>
          flat(item.categories).includes("Movilidad") ||
          item.category === "Movilidad",
      ).length,
      activation: exercises.filter(
        (item) =>
          flat(item.categories).includes("Activación") ||
          item.category === "Activación",
      ).length,
    };
    const entryPreviews = {
      upper: previewFrom(
        exercises.filter((item) => item.bodyRegion === "Tren superior"),
      ),
      lower: previewFrom(
        exercises.filter((item) => item.bodyRegion === "Tren inferior"),
      ),
      core: previewFrom(
        exercises.filter((item) => item.bodyRegion === "Zona media"),
      ),
      fullBody: previewFrom(
        exercises.filter(
          (item) => item.bodyRegion === "Cuerpo completo" && !isCardio(item),
        ),
      ),
      cardio: previewFrom(exercises.filter(isCardio)),
      mobility: previewFrom(
        exercises.filter(
          (item) =>
            flat(item.categories).includes("Movilidad") ||
            item.category === "Movilidad",
        ),
      ),
      activation: previewFrom(
        exercises.filter(
          (item) =>
            flat(item.categories).includes("Activación") ||
            item.category === "Activación",
        ),
      ),
    };

    res.set("Cache-Control", "private, max-age=300");
    const personalCount = exercises.filter(
      (exercise) => exercise.type === "custom" && Boolean(exercise.ownerId),
    ).length;

    res.json({
      total: exercises.length,
      sourceCounts: {
        all: exercises.length,
        system: exercises.length - personalCount,
        custom: personalCount,
      },
      categories: counts(
        exercises.flatMap((item) =>
          flat(item.categories).length
            ? flat(item.categories).map(canonicalizeCategory)
            : flat(item.category).map(canonicalizeCategory),
        ),
      ),
      bodyRegions: counts(
        exercises.map((item) => canonicalizeBodyRegion(item.bodyRegion)),
      ),
      groupsByRegion,
      equipment: counts(
        exercises.flatMap((item) =>
          flat(item.equipment).map(canonicalizeEquipment),
        ),
      ),
      movementPatterns: counts(
        exercises.flatMap((item) =>
          flat(item.movementPatterns).length
            ? flat(item.movementPatterns).map(canonicalizeMovementPattern)
            : flat(item.movementPattern).map(canonicalizeMovementPattern),
        ),
      ),
      difficulties: counts(exercises.map((item) => item.difficulty)),
      exerciseTypes: counts(exercises.map((item) => item.exerciseType)),
      positions: counts(exercises.map((item) => item.position)),
      goals: counts(exercises.flatMap((item) => flat(item.goals))),
      entryCounts,
      entryPreviews,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    let exercise = await Exercise.findById(req.params.id).lean();
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
    if (exercise.mergedIntoExerciseId) {
      exercise =
        (await Exercise.findById(exercise.mergedIntoExerciseId).lean()) ||
        exercise;
    }
    const isSystem = !exercise.ownerId || exercise.type === "system";
    if (!isSystem && !(await ensureCanAccessOwner(req, exercise.ownerId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    res.json(localizeExerciseDocument(exercise, getExerciseLanguage(req)));
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
      : "name localizedNames slug aliases category categories bodyRegion navigationRegion primaryMuscleGroup muscle primaryMuscle primaryMuscles secondaryMuscles stabilizerMuscles movementPattern movementPatterns equipment loadType weightConfig exerciseType laterality kineticChain executionType stability position difficulty goals mechanics force precautions branches tags type ownerId image imagePublicId media thumb supportsUnilateral movementMode source classificationStatus isActive updatedAt createdAt";
    const filter = {};
    const andFilters = [];
    const scope = await getVisibleExerciseScope(req);
    if (!scope) return res.status(403).json({ error: "No autorizado" });
    andFilters.push(scope);

    if (req.query.active !== "false") filter.isActive = { $ne: false };
    if (req.query.type === "custom") {
      filter.type = "custom";
      filter.ownerId = { $type: "string", $ne: "" };
    } else if (req.query.type === "system") {
      andFilters.push({
        $or: [
          { type: "system" },
          { ownerId: null },
          { ownerId: { $exists: false } },
        ],
      });
    }
    if (req.query.muscle) {
      const muscle = canonicalizeMuscleGroup(req.query.muscle);
      andFilters.push({
        $or: [
          { muscle },
          { primaryMuscle: muscle },
          { primaryMuscleGroup: muscle },
        ],
      });
    }
    if (req.query.category) {
      const category = canonicalizeCategory(req.query.category);
      andFilters.push({
        $or: [{ category }, { categories: category }],
      });
    }
    if (req.query.excludeCategory) {
      const category = canonicalizeCategory(req.query.excludeCategory);
      andFilters.push({
        $nor: [{ category }, { categories: category }],
      });
    }
    if (req.query.bodyRegion) {
      filter.bodyRegion = canonicalizeBodyRegion(req.query.bodyRegion);
    }
    if (req.query.navigationRegion) {
      filter.navigationRegion = req.query.navigationRegion;
    }
    if (req.query.primaryMuscleGroup) {
      const group = canonicalizeMuscleGroup(req.query.primaryMuscleGroup);
      andFilters.push({
        $or: [
          { primaryMuscleGroup: group },
          { primaryMuscle: group },
          { muscle: group },
        ],
      });
    }
    if (req.query.movementPattern) {
      const movementPattern = canonicalizeMovementPattern(
        req.query.movementPattern,
      );
      andFilters.push({
        $or: [{ movementPattern }, { movementPatterns: movementPattern }],
      });
    }
    if (req.query.equipment) {
      const equipment = canonicalizeEquipment(req.query.equipment);
      if (equipment === "Sin equipamiento") {
        filter.equipment = { $in: ["Sin equipamiento", "Peso corporal"] };
      } else {
        filter.equipment = equipment;
      }
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
      const terms = Array.from(
        new Set(
          expandSearchTerms(req.query.q).map(buildAccentInsensitivePattern),
        ),
      );
      const searchableFields = [
        "name",
        "slug",
        "localizedNames.es",
        "localizedNames.en",
        "nameSpanish",
        "nameEnglish",
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
        "description",
        "instructions",
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

    const includeMeta = req.query.meta === "true";
    const language = getExerciseLanguage(req);
    const cacheKey = JSON.stringify({
      page,
      limit,
      fields,
      filter,
      includeMeta,
      language,
    });
    const cached = readExerciseListCache(cacheKey);
    if (cached) {
      res.set("Cache-Control", "private, max-age=60");
      res.set("X-Data-Cache", "HIT");
      return res.json(cached);
    }

    const exercisesQuery = Exercise.find(filter, fields)
      .sort({ type: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .batchSize(limit)
      .maxTimeMS(10000)
      .lean();

    const [exercises, total] = await measureDatabase(res, () =>
      Promise.all([
        exercisesQuery,
        includeMeta
          ? Exercise.countDocuments(filter).maxTimeMS(10000)
          : Promise.resolve(null),
      ]),
    );

    const localizedExercises = exercises.map((exercise) =>
      localizeExerciseDocument(exercise, language),
    );
    const response = includeMeta
      ? {
          page,
          limit,
          count: localizedExercises.length,
          total,
          items: localizedExercises,
        }
      : localizedExercises;
    writeExerciseListCache(cacheKey, response);
    res.set("Cache-Control", "private, max-age=60");
    res.set("X-Data-Cache", "MISS");
    res.json(response);
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
    clearExerciseFacetCache();
    res
      .status(201)
      .json(localizeExerciseDocument(exercise, getExerciseLanguage(req)));
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
    clearExerciseFacetCache();
    res.json(localizeExerciseDocument(exercise, getExerciseLanguage(req)));
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
      clearExerciseFacetCache();
      return res.json({ ok: true, softDeleted: true });
    }
    await Exercise.findByIdAndDelete(req.params.id);
    clearExerciseFacetCache();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
