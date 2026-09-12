import { Router } from "express";
import AthleteAssessment from "../models/AthleteAssessment.js";
import TrainingPlan from "../models/TrainingPlan.js";
import { ensureCanAccessOwner, protect } from "../middleware/authMiddleware.js";
import { deleteCacheByPrefix } from "../services/cacheService.js";
import CoachNotification from "../models/CoachNotification.js";

const router = Router();
const localDateKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const athleteId = String(req.query.athleteId || req.user.id);
    if (!(await ensureCanAccessOwner(req, athleteId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const assessments = await AthleteAssessment.find({ athleteId })
      .sort({ dateKey: -1 })
      .limit(24)
      .lean();
    return res.json({ assessments });
  } catch (error) {
    return next(error);
  }
});

router.post("/final", async (req, res, next) => {
  try {
    const athleteId = String(req.body.athleteId || req.user.id);
    if (!(await ensureCanAccessOwner(req, athleteId))) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const plan = await TrainingPlan.findOne({
      _id: String(req.body.planId || ""),
      athleteId,
      coachId: { $ne: null },
    }).lean();
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    const progress = Number(req.body.answers?.progress);
    const goalReached = String(req.body.answers?.goalReached || "");
    if (!Number.isInteger(progress) || progress < 1 || progress > 5) {
      return res.status(400).json({ error: "Califica tu progreso" });
    }
    if (!["yes", "partly", "no"].includes(goalReached)) {
      return res
        .status(400)
        .json({ error: "Indica cómo avanzaste hacia tu objetivo" });
    }
    const existingAssessment = await AthleteAssessment.exists({
      athleteId,
      planId: String(plan._id),
      type: "final",
    });
    const assessment = await AthleteAssessment.findOneAndUpdate(
      { athleteId, planId: String(plan._id), type: "final" },
      {
        $set: {
          coachId: String(plan.coachId),
          dateKey: String(req.body.dateKey || localDateKey()),
          answers: {
            progress,
            goalReached,
            pain: String(req.body.answers?.pain || "")
              .trim()
              .slice(0, 500),
            feedback: String(req.body.answers?.feedback || "")
              .trim()
              .slice(0, 1000),
            availabilityChanged: Boolean(req.body.answers?.availabilityChanged),
          },
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
    await deleteCacheByPrefix(`dashboard:${athleteId}:`);
    if (!existingAssessment) {
      await CoachNotification.create({
        coachId: String(plan.coachId),
        athleteId,
        entityId: String(assessment._id),
        type: "final_assessment_submitted",
        title: "Evaluación final recibida",
        message: `${req.user.name || "Tu alumno"} completó la evaluación de ${plan.name}.`,
      }).catch(() => {});
    }
    return res.status(201).json({ assessment });
  } catch (error) {
    return next(error);
  }
});

export default router;
