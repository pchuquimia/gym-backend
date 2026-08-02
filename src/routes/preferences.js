import { Router } from "express";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import Preference from "../models/Preference.js";

const router = Router();
const BRANCHES = ["sopocachi", "miraflores"];
const LOCATION_MODES = ["single", "multiple", "disabled"];
const normalizeBranch = (value) =>
  BRANCHES.includes(value) ? value : "sopocachi";
const normalizeLocationMode = (value) =>
  LOCATION_MODES.includes(value) ? value : "single";
const normalizeAllowedBranches = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : []).filter((branch) =>
        BRANCHES.includes(branch),
      ),
    ),
  );
const normalizePreference = (pref, userId) => {
  let branch = normalizeBranch(pref?.branch);
  const locationMode = normalizeLocationMode(pref?.locationMode);
  let allowedBranches = normalizeAllowedBranches(pref?.allowedBranches);
  if (locationMode === "single") allowedBranches = [branch];
  if (locationMode === "multiple" && allowedBranches.length < 2) {
    allowedBranches = [...BRANCHES];
  }
  if (locationMode === "multiple" && !allowedBranches.includes(branch)) {
    [branch] = allowedBranches;
  }
  if (locationMode === "disabled") allowedBranches = [];
  return {
    ...(pref || {}),
    userId,
    branch,
    locationMode,
    allowedBranches,
    goals: pref?.goals || {},
  };
};

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    if (!(await ensureCanAccessOwner(req, userId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const pref = await Preference.findOne({ userId }).lean();
    res.set("Cache-Control", "no-store");
    res.json(normalizePreference(pref, userId));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const userId = req.body.userId || req.user.id;
    if (!(await ensureCanAccessOwner(req, userId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const current = await Preference.findOne({ userId }).lean();
    const update = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "branch")) {
      update.branch = normalizeBranch(req.body.branch);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "goals")) {
      update.goals = req.body.goals || {};
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "locationMode")) {
      update.locationMode = normalizeLocationMode(req.body.locationMode);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "allowedBranches")) {
      update.allowedBranches = normalizeAllowedBranches(
        req.body.allowedBranches,
      );
    }

    const normalized = normalizePreference({ ...current, ...update }, userId);
    update.branch = normalized.branch;
    update.locationMode = normalized.locationMode;
    update.allowedBranches = normalized.allowedBranches;

    const pref = await Preference.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.set("Cache-Control", "no-store");
    res.status(201).json(normalizePreference(pref.toObject(), userId));
  } catch (err) {
    next(err);
  }
});

export default router;
