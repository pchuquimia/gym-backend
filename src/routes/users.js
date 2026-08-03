import { Router } from "express";
import { body } from "express-validator";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import User, { TRAINING_MODES, USER_ROLES } from "../models/User.js";
import Exercise from "../models/Exercise.js";
import Photo from "../models/Photo.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
import TrainingPlan from "../models/TrainingPlan.js";

const router = Router();
const ADMIN_USER_FIELDS =
  "name email role isActive assignedTrainerId trainingMode createdAt updatedAt";
const CLIENT_DIRECTORY_FIELDS =
  "name role isActive assignedTrainerId trainingMode";

router.use(protect);

router.get("/", authorizeRoles("Admin"), async (_req, res, next) => {
  try {
    const users = await User.find({}, ADMIN_USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.set("Cache-Control", "no-store");
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/clients",
  authorizeRoles("Entrenador", "Admin"),
  async (req, res, next) => {
    try {
      const filter =
        req.user.role === "Admin"
          ? { role: "Cliente" }
          : { role: "Cliente", assignedTrainerId: req.user.id, isActive: true };
      const users = await User.find(filter, CLIENT_DIRECTORY_FIELDS)
        .sort({ name: 1 })
        .lean();
      res.set("Cache-Control", "no-store");
      res.json(users);
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  authorizeRoles("Admin"),
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 80 })
      .withMessage("Nombre inválido"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage("Email inválido"),
    body("role").optional().isIn(USER_ROLES).withMessage("Rol inválido"),
    body("isActive").optional().isBoolean().withMessage("Estado inválido"),
    body("assignedTrainerId")
      .optional({ nullable: true })
      .isString()
      .withMessage("Entrenador inválido"),
    body("trainingMode")
      .optional()
      .isIn(TRAINING_MODES)
      .withMessage("Tipo de usuario inválido"),
    validate,
  ],
  async (req, res, next) => {
    try {
      if (req.body.assignedTrainerId) {
        const trainerExists = await User.exists({
          _id: req.body.assignedTrainerId,
          role: "Entrenador",
          isActive: true,
        });
        if (!trainerExists) {
          return res.status(400).json({ error: "Entrenador inválido" });
        }
      }
      const allowed = [
        "name",
        "email",
        "role",
        "isActive",
        "assignedTrainerId",
        "trainingMode",
      ];
      const payload = {};
      allowed.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(req.body, key))
          payload[key] = req.body[key];
      });
      const current = await User.findById(
        req.params.id,
        "role assignedTrainerId trainingMode",
      ).lean();
      if (!current) return res.status(404).json({ error: "Not found" });
      const nextRole = payload.role || current.role;
      const nextTrainerId = Object.prototype.hasOwnProperty.call(
        payload,
        "assignedTrainerId",
      )
        ? payload.assignedTrainerId
        : current.assignedTrainerId;
      if (nextRole !== "Cliente") {
        payload.trainingMode = "independent";
        payload.assignedTrainerId = null;
      } else if (nextTrainerId) {
        payload.trainingMode = "coach_managed";
      } else {
        payload.trainingMode = "independent";
      }
      const effectiveTrainerId =
        nextRole === "Cliente" ? nextTrainerId || null : null;
      const user = await User.findByIdAndUpdate(req.params.id, payload, {
        new: true,
        runValidators: true,
      }).select(ADMIN_USER_FIELDS);
      if (!user) return res.status(404).json({ error: "Not found" });
      const trainerChanged =
        String(current.assignedTrainerId || "") !==
        String(effectiveTrainerId || "");
      if (
        current.role === "Cliente" &&
        trainerChanged &&
        current.assignedTrainerId
      ) {
        const previousPlans = await TrainingPlan.find(
          {
            athleteId: req.params.id,
            coachId: current.assignedTrainerId,
            status: "active",
          },
          "weeklySchedule.routineId",
        ).lean();
        const previousPlanIds = previousPlans.map((plan) => String(plan._id));
        const previousRoutineIds = previousPlans.flatMap((plan) =>
          (plan.weeklySchedule || [])
            .map((day) => day.routineId)
            .filter(Boolean),
        );
        await TrainingPlan.updateMany(
          { _id: { $in: previousPlanIds } },
          { $set: { status: "paused" } },
        );
        if (
          effectiveTrainerId &&
          (previousPlanIds.length || previousRoutineIds.length)
        ) {
          await Routine.updateMany(
            {
              ownerId: req.params.id,
              $or: [
                { trainingPlanId: { $in: previousPlanIds } },
                { _id: { $in: previousRoutineIds } },
              ],
            },
            { $set: { isArchived: true } },
          );
        }
        if (
          !effectiveTrainerId &&
          (previousPlanIds.length || previousRoutineIds.length)
        ) {
          await Routine.updateMany(
            {
              ownerId: req.params.id,
              $or: [
                { trainingPlanId: { $in: previousPlanIds } },
                { _id: { $in: previousRoutineIds } },
              ],
            },
            {
              $set: {
                trainingPlanId: null,
                assignmentType: "personal",
                isArchived: false,
              },
            },
          );
        }
      }
      const trainerLosesAccess =
        current.role === "Entrenador" &&
        (nextRole !== "Entrenador" || payload.isActive === false);
      if (trainerLosesAccess) {
        const assignedClients = await User.find(
          { assignedTrainerId: req.params.id },
          "_id",
        ).lean();
        const assignedClientIds = assignedClients.map((client) =>
          String(client._id),
        );
        await User.updateMany(
          { assignedTrainerId: req.params.id },
          {
            $set: {
              assignedTrainerId: null,
              trainingMode: "independent",
            },
          },
        );
        await TrainingPlan.updateMany(
          { coachId: req.params.id, status: "active" },
          { $set: { status: "paused" } },
        );
        if (assignedClientIds.length) {
          await Routine.updateMany(
            {
              ownerId: { $in: assignedClientIds },
              assignedByCoachId: req.params.id,
            },
            {
              $set: {
                trainingPlanId: null,
                assignmentType: "personal",
                isArchived: false,
              },
            },
          );
        }
      }
      res.json(user);
    } catch (err) {
      next(err);
    }
  },
);

router.delete("/:id", authorizeRoles("Admin"), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "No puedes eliminar tu cuenta" });
    }
    const user = await User.findById(req.params.id, "role").lean();
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    if (user.role === "Admin") {
      return res.status(403).json({
        error: "Las cuentas administrativas no se eliminan desde aquí",
      });
    }

    const ownerId = user._id.toString();
    if (user.role === "Entrenador") {
      await Routine.updateMany(
        { assignedByCoachId: ownerId },
        {
          $set: {
            trainingPlanId: null,
            assignmentType: "personal",
            isArchived: false,
          },
        },
      );
    }
    const [
      routines,
      trainings,
      sessions,
      photos,
      preferences,
      exercises,
      plans,
    ] = await Promise.all([
      Routine.deleteMany({ ownerId }),
      Training.deleteMany({ ownerId }),
      Session.deleteMany({ ownerId }),
      Photo.deleteMany({ ownerId }),
      Preference.deleteMany({ userId: ownerId }),
      Exercise.deleteMany({ ownerId, type: "custom" }),
      TrainingPlan.deleteMany({
        $or: [{ athleteId: ownerId }, { coachId: ownerId }],
      }),
      User.updateMany(
        { assignedTrainerId: ownerId },
        {
          $set: {
            assignedTrainerId: null,
            trainingMode: "independent",
          },
        },
      ),
    ]);

    await User.findByIdAndDelete(ownerId);
    res.json({
      ok: true,
      deleted: {
        routines: routines.deletedCount,
        trainings: trainings.deletedCount,
        sessions: sessions.deletedCount,
        photos: photos.deletedCount,
        preferences: preferences.deletedCount,
        exercises: exercises.deletedCount,
        plans: plans.deletedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
