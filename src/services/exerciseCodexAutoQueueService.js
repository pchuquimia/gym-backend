import CodexImageRequest from "../models/CodexImageRequest.js";
import Exercise from "../models/Exercise.js";
import {
  buildExerciseCodexImagePrompt,
  getExerciseReferenceImage,
} from "./exerciseCodexImageService.js";

const ACTIVE_STATUSES = ["pending", "processing", "ready"];
const SAME_IMAGE_TERMINAL_STATUSES = [
  "applied",
  "cancelled",
  "failed",
  "rejected",
  "skipped",
];
const DEFAULT_MAX_OUTSTANDING = 25;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SYSTEM_REQUESTED_BY = "system:auto-image-queue";

const positiveInteger = (value, fallback, maximum = 500) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
};

export const getCodexAutoQueueConfig = () => ({
  enabled:
    String(process.env.CODEX_IMAGE_AUTO_QUEUE || "true").toLowerCase() !==
    "false",
  maxOutstanding: positiveInteger(
    process.env.CODEX_IMAGE_AUTO_QUEUE_MAX_OUTSTANDING,
    DEFAULT_MAX_OUTSTANDING,
    200,
  ),
  intervalMs: positiveInteger(
    process.env.CODEX_IMAGE_AUTO_QUEUE_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    24 * 60 * 60 * 1000,
  ),
});

export const shouldQueueExerciseImage = ({ referenceImage, latest }) => {
  if (!referenceImage) return false;
  if (!latest) return true;
  if (ACTIVE_STATUSES.includes(latest.status)) return false;
  if (
    latest.referenceImage === referenceImage &&
    SAME_IMAGE_TERMINAL_STATUSES.includes(latest.status)
  ) {
    return false;
  }
  return true;
};

export const enqueueCodexImageRequestForExercise = async ({
  exercise,
  requestedBy = SYSTEM_REQUESTED_BY,
  instruction = "",
  source = "automatic",
  parentRequestId = "",
  force = false,
}) => {
  if (!exercise?._id) {
    throw new Error("El ejercicio es obligatorio para crear la solicitud");
  }

  const exerciseId = String(exercise._id);
  const referenceImage = getExerciseReferenceImage(exercise);
  const latest = await CodexImageRequest.findOne({ exerciseId }).sort({
    createdAt: -1,
  });

  if (latest && ACTIVE_STATUSES.includes(latest.status)) {
    return { request: latest, reused: true, skipped: false };
  }
  if (!force && source === "automatic") {
    if (!shouldQueueExerciseImage({ referenceImage, latest })) {
      return { request: latest, reused: false, skipped: true };
    }
  }

  const cleanInstruction = String(instruction || "")
    .trim()
    .slice(0, 2000);
  const attempt = parentRequestId
    ? Math.max(Number(latest?.attempt) || 1, 1) + 1
    : 1;
  const request = await CodexImageRequest.create({
    exerciseId,
    exerciseName: exercise.localizedNames?.es || exercise.name,
    referenceImage,
    instruction: cleanInstruction,
    prompt: buildExerciseCodexImagePrompt(exercise, cleanInstruction),
    requestedBy: String(requestedBy || SYSTEM_REQUESTED_BY),
    source,
    attempt,
    parentRequestId: parentRequestId ? String(parentRequestId) : "",
  });
  return { request, reused: false, skipped: false };
};

const eligibleExerciseFilter = {
  isActive: { $ne: false },
  $and: [
    {
      $or: [
        { type: "system" },
        { ownerId: null },
        { ownerId: { $exists: false } },
      ],
    },
    {
      $or: [
        { "media.image.url": /^https?:\/\//i },
        { image: /^https?:\/\//i },
        { thumb: /^https?:\/\//i },
      ],
    },
  ],
};

export const enqueueEligibleCodexImageRequests = async ({ limit } = {}) => {
  const config = getCodexAutoQueueConfig();
  if (!config.enabled) {
    return { enabled: false, created: 0, outstanding: 0 };
  }

  const outstanding = await CodexImageRequest.countDocuments({
    status: { $in: ACTIVE_STATUSES },
  });
  const capacity = Math.max(config.maxOutstanding - outstanding, 0);
  const requestedLimit = positiveInteger(limit, capacity || 1, 200);
  const target = Math.min(capacity, requestedLimit);
  if (!target) {
    return { enabled: true, created: 0, outstanding, capacity: 0 };
  }

  const pageSize = Math.max(target * 8, 100);
  let cursor = null;
  let created = 0;
  let scanned = 0;

  while (created < target) {
    const filter = cursor
      ? { ...eligibleExerciseFilter, _id: { $gt: cursor } }
      : eligibleExerciseFilter;
    const exercises = await Exercise.find(filter)
      .sort({ _id: 1 })
      .limit(pageSize)
      .lean();
    if (!exercises.length) break;

    scanned += exercises.length;
    cursor = exercises.at(-1)._id;
    const exerciseIds = exercises.map((exercise) => String(exercise._id));
    const existing = await CodexImageRequest.find({
      exerciseId: { $in: exerciseIds },
    })
      .sort({ createdAt: -1 })
      .lean();
    const latestByExercise = new Map();
    existing.forEach((request) => {
      if (!latestByExercise.has(request.exerciseId)) {
        latestByExercise.set(request.exerciseId, request);
      }
    });

    for (const exercise of exercises) {
      if (created >= target) break;
      let referenceImage = "";
      try {
        referenceImage = getExerciseReferenceImage(exercise);
      } catch {
        continue;
      }
      const latest = latestByExercise.get(String(exercise._id));
      if (!shouldQueueExerciseImage({ referenceImage, latest })) continue;
      const result = await enqueueCodexImageRequestForExercise({ exercise });
      if (!result.reused && !result.skipped) created += 1;
    }

    if (exercises.length < pageSize) break;
  }

  return {
    enabled: true,
    created,
    scanned,
    outstanding: outstanding + created,
    capacity: Math.max(capacity - created, 0),
  };
};

export const startCodexImageAutoQueue = () => {
  const config = getCodexAutoQueueConfig();
  if (!config.enabled) return null;

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await enqueueEligibleCodexImageRequests();
      if (result.created) {
        console.log(
          `Cola automatica de imagenes: ${result.created} solicitud(es) creada(s)`,
        );
      }
    } catch (error) {
      console.error(`Cola automatica de imagenes: ${error.message}`);
    } finally {
      running = false;
    }
  };

  const firstRun = setTimeout(run, 1500);
  firstRun.unref?.();
  const timer = setInterval(run, config.intervalMs);
  timer.unref?.();
  return timer;
};

export { ACTIVE_STATUSES, SYSTEM_REQUESTED_BY };
