import { Router } from "express";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import TrainingDraft from "../models/TrainingDraft.js";
import { validateTrainingDraftSnapshot } from "../utils/trainingDraft.js";

const router = Router();
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

router.use(protect);

const resolveOwnerId = async (req, value) => {
  const ownerId = String(value || req.user.id).trim();
  if (!(await ensureCanAccessOwner(req, ownerId))) {
    const error = new Error("No autorizado para acceder a este borrador");
    error.statusCode = 403;
    throw error;
  }
  return ownerId;
};

router.get("/active", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.query.ownerId);
    const draft = await TrainingDraft.findOne({
      ownerId,
      startedById: req.user.id,
    })
      .select(
        "ownerId startedById trainingRequestId routineId sessionDate snapshot updatedAt expiresAt",
      )
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json({ draft: draft || null });
  } catch (error) {
    next(error);
  }
});

router.put("/active", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(req, req.body?.ownerId);
    const validation = validateTrainingDraftSnapshot(req.body?.snapshot);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        code: "INVALID_TRAINING_DRAFT",
      });
    }

    const snapshot = {
      ...validation.snapshot,
      ownerId,
      startedById: req.user.id,
    };
    const trainingRequestId = String(snapshot.trainingRequestId).trim();
    const routineId = String(snapshot.selectedRoutineId).trim();
    const sessionDate = String(snapshot.sessionDate || "").slice(0, 10);
    const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);

    const draft = await TrainingDraft.findOneAndUpdate(
      { ownerId, startedById: req.user.id },
      {
        $set: {
          trainingRequestId,
          routineId,
          sessionDate,
          snapshot,
          expiresAt,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    res.set("Cache-Control", "private, no-store");
    res.json({
      draft: {
        trainingRequestId: draft.trainingRequestId,
        routineId: draft.routineId,
        sessionDate: draft.sessionDate,
        updatedAt: draft.updatedAt,
        expiresAt: draft.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/active", async (req, res, next) => {
  try {
    const ownerId = await resolveOwnerId(
      req,
      req.body?.ownerId || req.query.ownerId,
    );
    await TrainingDraft.deleteOne({ ownerId, startedById: req.user.id });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
