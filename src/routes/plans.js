import { Router } from "express";
import {
  authorizeRoles,
  ensureCanAccessOwner,
  protect,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";

const router = Router();

router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const athleteId = String(
      req.query.athleteId || (req.user.role === "Admin" ? "" : req.user.id),
    ).trim();
    if (!athleteId && req.user.role === "Admin") {
      return res.status(400).json({ error: "Selecciona un atleta" });
    }
    if (
      req.user.role !== "Admin" &&
      !(await ensureCanAccessOwner(req, athleteId))
    ) {
      return res
        .status(403)
        .json({ error: "No autorizado para consultar este plan" });
    }
    const filter = { athleteId };
    if (req.user.role === "Entrenador") filter.coachId = req.user.id;
    const plans = await TrainingPlan.find(filter)
      .sort({ status: 1, updatedAt: -1 })
      .lean();
    res.set("Cache-Control", "private, no-store");
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authorizeRoles("Admin"), async (req, res, next) => {
  try {
    const plan = await TrainingPlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    const routineIds = (plan.weeklySchedule || [])
      .map((day) => day.routineId)
      .filter(Boolean);
    const [routineResult] = await Promise.all([
      Routine.updateMany(
        {
          ownerId: plan.athleteId,
          $or: [
            { trainingPlanId: String(plan._id) },
            { _id: { $in: routineIds } },
          ],
        },
        { $set: { isArchived: true } },
      ),
      TrainingPlan.findByIdAndDelete(plan._id),
    ]);
    res.json({ ok: true, archivedRoutines: routineResult.modifiedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
