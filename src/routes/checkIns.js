import { Router } from "express";
import AthleteCheckIn from "../models/AthleteCheckIn.js";
import {
  ensureCanAccessOwner,
  protect,
  requireFeature,
} from "../middleware/authMiddleware.js";
import {
  calculateReadiness,
  dateKey,
  shiftDateKey,
} from "../utils/coachPremium.js";
import { PREMIUM_FEATURES } from "../utils/subscription.js";
import { enqueueAthleteMetricRefresh } from "../services/metricRefreshQueue.js";

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAIN_AREAS = new Set([
  "cuello",
  "hombro",
  "codo",
  "muneca",
  "espalda",
  "cadera",
  "rodilla",
  "tobillo",
  "otro",
]);

router.use(protect);
router.use(requireFeature(PREMIUM_FEATURES.DAILY_CHECKIN));

const requestedAthleteId = (req) =>
  String(req.query.athleteId || req.body.athleteId || req.user.id).trim();

const requireOwnerAccess = async (req, ownerId) => {
  if (await ensureCanAccessOwner(req, ownerId)) return;
  const error = new Error("No autorizado para acceder a este check-in");
  error.statusCode = 403;
  throw error;
};

const normalizeDate = (value) => {
  const normalized = String(value || "").trim();
  if (!DATE_PATTERN.test(normalized)) return "";
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || dateKey(parsed) !== normalized
    ? ""
    : normalized;
};

const normalizeScore = (value, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    const error = new Error(`${label} debe estar entre 1 y 5`);
    error.statusCode = 400;
    throw error;
  }
  return number;
};

router.get("/latest", async (req, res, next) => {
  try {
    const athleteId = requestedAthleteId(req);
    await requireOwnerAccess(req, athleteId);
    const checkIn = await AthleteCheckIn.findOne({ athleteId })
      .sort({ dateKey: -1, updatedAt: -1 })
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json({ checkIn: checkIn || null });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const athleteId = requestedAthleteId(req);
    await requireOwnerAccess(req, athleteId);
    const today = dateKey();
    const from = normalizeDate(req.query.from) || shiftDateKey(today, -29);
    const to = normalizeDate(req.query.to) || today;
    const checkIns = await AthleteCheckIn.find({
      athleteId,
      dateKey: { $gte: from, $lte: to },
    })
      .sort({ dateKey: -1 })
      .limit(90)
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json({ checkIns, range: { from, to } });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const athleteId = requestedAthleteId(req);
    await requireOwnerAccess(req, athleteId);
    const submittedDate = normalizeDate(req.body.dateKey || dateKey());
    if (!submittedDate) {
      return res.status(400).json({ error: "Fecha de check-in invalida" });
    }
    const payload = {
      sleep: normalizeScore(req.body.sleep, "Sueno"),
      energy: normalizeScore(req.body.energy, "Energia"),
      stress: normalizeScore(req.body.stress, "Estres"),
      soreness: normalizeScore(req.body.soreness, "Dolor muscular"),
      motivation: normalizeScore(req.body.motivation, "Motivacion"),
      jointPain: normalizeScore(req.body.jointPain, "Molestia articular"),
    };
    const readiness = calculateReadiness(payload);
    const painAreas = [
      ...new Set(
        (req.body.painAreas || []).map((item) =>
          String(item).trim().toLowerCase(),
        ),
      ),
    ]
      .filter((item) => PAIN_AREAS.has(item))
      .slice(0, 8);
    const checkIn = await AthleteCheckIn.findOneAndUpdate(
      { athleteId, dateKey: submittedDate },
      {
        $set: {
          ...payload,
          painAreas,
          notes: String(req.body.notes || "")
            .trim()
            .slice(0, 500),
          readinessScore: readiness.score,
          readinessState: readiness.state,
          submittedBy: req.user.id,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
    await enqueueAthleteMetricRefresh(athleteId, submittedDate);
    res.status(201).json({ checkIn, recommendation: readiness.recommendation });
  } catch (error) {
    next(error);
  }
});

export default router;
