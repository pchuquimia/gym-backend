import crypto from "crypto";
import { Router } from "express";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import Training from "../models/Training.js";
import User from "../models/User.js";

const router = Router();

router.use(protect, authorizeRoles("Entrenador"));

const athleteFilter = (coachId, athleteId) => ({
  _id: athleteId,
  role: "Cliente",
  assignedTrainerId: coachId,
  isActive: true,
});

const getAthlete = async (coachId, athleteId) =>
  User.findOne(
    athleteFilter(coachId, athleteId),
    "name email role profile.goal profile.weight profile.height profile.avatarPhotoId",
  ).lean();

router.get("/athletes", async (req, res, next) => {
  try {
    const athletes = await User.find(
      {
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      },
      "name email profile.goal profile.weight profile.height profile.avatarPhotoId updatedAt",
    )
      .sort({ name: 1 })
      .lean();

    const enriched = await Promise.all(
      athletes.map(async (athlete) => {
        const athleteId = athlete._id.toString();
        const [routineCount, trainingCount, lastTraining] = await Promise.all([
          Routine.countDocuments({ ownerId: athleteId }),
          Training.countDocuments({ ownerId: athleteId }),
          Training.findOne({ ownerId: athleteId }, "date routineName")
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        ]);
        return {
          ...athlete,
          id: athleteId,
          routineCount,
          trainingCount,
          lastTraining: lastTraining || null,
        };
      }),
    );

    res.set("Cache-Control", "private, no-store");
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.get("/athletes/:athleteId/overview", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const ownerId = athlete._id.toString();
    const [routines, recentTrainings] = await Promise.all([
      Routine.find({ ownerId })
        .sort({ updatedAt: -1 })
        .select("name branch exercises assignedByCoachId assignedAt updatedAt")
        .lean(),
      Training.find({ ownerId })
        .sort({ date: -1, createdAt: -1 })
        .limit(12)
        .select(
          "date routineId routineName durationSeconds totalVolume sessionType supervisedBy exercises",
        )
        .lean(),
    ]);

    const totalVolume = recentTrainings.reduce(
      (sum, training) => sum + (Number(training.totalVolume) || 0),
      0,
    );
    res.set("Cache-Control", "private, no-store");
    res.json({
      athlete: { ...athlete, id: ownerId },
      routines,
      recentTrainings,
      metrics: {
        routines: routines.length,
        sessions: recentTrainings.length,
        recentVolume: totalVolume,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/athletes/:athleteId/routines", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const sourceRoutineId = String(req.body.sourceRoutineId || "").trim();
    if (!sourceRoutineId) {
      return res.status(400).json({ error: "Selecciona una rutina" });
    }
    const source = await Routine.findOne({
      _id: sourceRoutineId,
      ownerId: req.user.id,
    }).lean();
    if (!source) {
      return res.status(404).json({ error: "Plantilla no encontrada" });
    }

    const routine = await Routine.create({
      _id: `routine_${crypto.randomUUID()}`,
      name: String(req.body.name || source.name).trim(),
      description: source.description || "",
      branch: req.body.branch || source.branch,
      exercises: source.exercises || [],
      ownerId: athlete._id.toString(),
      progressMode: "fresh",
      progressScopeId: `scope_${crypto.randomUUID()}`,
      sourceRoutineId: source._id,
      assignedByCoachId: req.user.id,
      assignedAt: new Date(),
    });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

export default router;
