import crypto from "crypto";
import { Router } from "express";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import Training from "../models/Training.js";
import User from "../models/User.js";

const router = Router();
const PLAN_LEVELS = ["beginner", "intermediate", "advanced"];
const PROGRESSION_STRATEGIES = [
  "double_progression",
  "linear",
  "rpe",
  "custom",
];

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

const normalizeSchedule = (value) => {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const days = value.map((day) => ({
    dayIndex: Number(day.dayIndex),
    type: ["training", "rest", "recovery"].includes(day.type)
      ? day.type
      : "training",
    focus: String(day.focus || "").trim(),
    sourceRoutineId:
      day.type === "training" && day.sourceRoutineId
        ? String(day.sourceRoutineId).trim()
        : null,
  }));
  const indexes = new Set(days.map((day) => day.dayIndex));
  if (
    indexes.size !== 7 ||
    [...indexes].some((index) => index < 1 || index > 7)
  ) {
    return null;
  }
  return days.sort((a, b) => a.dayIndex - b.dayIndex);
};

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
          Routine.countDocuments({
            ownerId: athleteId,
            isArchived: { $ne: true },
          }),
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
    const [routines, recentTrainings, plans] = await Promise.all([
      Routine.find({ ownerId, isArchived: { $ne: true } })
        .sort({ updatedAt: -1 })
        .select(
          "name branch exercises assignedByCoachId assignedAt trainingPlanId assignmentType updatedAt",
        )
        .lean(),
      Training.find({ ownerId })
        .sort({ date: -1, createdAt: -1 })
        .limit(12)
        .select(
          "date routineId routineName durationSeconds totalVolume sessionType supervisedBy exercises",
        )
        .lean(),
      TrainingPlan.find({ athleteId: ownerId, coachId: req.user.id })
        .sort({ updatedAt: -1 })
        .limit(12)
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
      plans,
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

router.post("/athletes/:athleteId/plans", async (req, res, next) => {
  const createdRoutineIds = [];
  let createdPlanId = null;
  let previousPlanIds = [];
  let previousRoutineIds = [];
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }

    const schedule = normalizeSchedule(req.body.weeklySchedule);
    if (!schedule) {
      return res
        .status(400)
        .json({ error: "La semana debe contener 7 dias validos" });
    }
    if (!schedule.some((day) => day.type === "training")) {
      return res
        .status(400)
        .json({ error: "El plan necesita al menos un dia de entrenamiento" });
    }
    if (
      schedule.some((day) => day.type === "training" && !day.sourceRoutineId)
    ) {
      return res.status(400).json({
        error: "Asigna una rutina a cada dia de entrenamiento",
      });
    }
    const durationWeeks = Number(req.body.durationWeeks) || 8;
    if (
      !Number.isInteger(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      return res
        .status(400)
        .json({ error: "La duracion debe ser de 1 a 52 semanas" });
    }
    const planName = String(req.body.name || "").trim();
    if (!planName || planName.length > 100) {
      return res.status(400).json({ error: "Ingresa un nombre para el plan" });
    }
    const level = PLAN_LEVELS.includes(req.body.level)
      ? req.body.level
      : "beginner";
    const strategy = PROGRESSION_STRATEGIES.includes(
      req.body.progression?.strategy,
    )
      ? req.body.progression.strategy
      : "double_progression";
    const deloadEveryWeeks =
      Number(req.body.progression?.deloadEveryWeeks) || 0;
    if (deloadEveryWeeks < 0 || deloadEveryWeeks > 12) {
      return res
        .status(400)
        .json({ error: "La descarga programada no es valida" });
    }
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (startDate && Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "La fecha de inicio no es valida" });
    }

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = sourceIds.length
      ? await Routine.find({
          _id: { $in: sourceIds },
          ownerId: req.user.id,
          isArchived: { $ne: true },
        }).lean()
      : [];
    if (sources.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "Una de las plantillas no esta disponible" });
    }

    const previousPlans = await TrainingPlan.find(
      {
        athleteId: athlete._id.toString(),
        status: "active",
      },
      "weeklySchedule.routineId",
    ).lean();
    previousPlanIds = previousPlans.map((plan) => String(plan._id));
    previousRoutineIds = previousPlans.flatMap((plan) =>
      (plan.weeklySchedule || []).map((day) => day.routineId).filter(Boolean),
    );

    const plan = new TrainingPlan({
      name: planName,
      coachId: req.user.id,
      athleteId: athlete._id.toString(),
      level,
      goal: req.body.goal,
      durationWeeks,
      startDate,
      status: "active",
      progression: { strategy, deloadEveryWeeks },
      notes: req.body.notes,
      weeklySchedule: [],
    });
    createdPlanId = plan._id;

    const assignedRoutineBySource = new Map();
    for (const source of sources) {
      const routineId = `routine_${crypto.randomUUID()}`;
      const assignedRoutine = await Routine.create({
        _id: routineId,
        name: source.name,
        description: source.description || "",
        branch: source.branch,
        exercises: source.exercises || [],
        ownerId: athlete._id.toString(),
        progressMode: "fresh",
        progressScopeId: `scope_${crypto.randomUUID()}`,
        sourceRoutineId: source._id,
        assignedByCoachId: req.user.id,
        assignedAt: new Date(),
        trainingPlanId: String(plan._id),
        assignmentType: "plan",
        isArchived: false,
      });
      createdRoutineIds.push(routineId);
      assignedRoutineBySource.set(String(source._id), assignedRoutine._id);
    }

    plan.weeklySchedule = schedule.map((day) => ({
      ...day,
      sourceRoutineId: day.type === "training" ? day.sourceRoutineId : null,
      routineId:
        day.type === "training" && day.sourceRoutineId
          ? assignedRoutineBySource.get(day.sourceRoutineId)
          : null,
    }));
    await plan.save();

    await TrainingPlan.updateMany(
      {
        _id: { $ne: plan._id },
        athleteId: athlete._id.toString(),
        status: "active",
      },
      { $set: { status: "paused" } },
    );
    if (previousPlanIds.length || previousRoutineIds.length) {
      await Routine.updateMany(
        {
          ownerId: athlete._id.toString(),
          $or: [
            { trainingPlanId: { $in: previousPlanIds } },
            { _id: { $in: previousRoutineIds } },
          ],
        },
        { $set: { isArchived: true } },
      );
    }

    res.status(201).json(plan);
  } catch (err) {
    if (createdPlanId) {
      await TrainingPlan.findByIdAndDelete(createdPlanId).catch(() => {});
    }
    if (createdRoutineIds.length) {
      await Routine.deleteMany({ _id: { $in: createdRoutineIds } }).catch(
        () => {},
      );
    }
    if (previousPlanIds.length) {
      await TrainingPlan.updateMany(
        { _id: { $in: previousPlanIds } },
        { $set: { status: "active" } },
      ).catch(() => {});
      await Routine.updateMany(
        {
          ownerId: req.params.athleteId,
          $or: [
            { trainingPlanId: { $in: previousPlanIds } },
            { _id: { $in: previousRoutineIds } },
          ],
        },
        { $set: { isArchived: false } },
      ).catch(() => {});
    }
    next(err);
  }
});

router.patch(
  "/athletes/:athleteId/plans/:planId/status",
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete) {
        return res.status(404).json({ error: "Atleta no encontrado" });
      }
      const status = String(req.body.status || "");
      if (!["active", "paused", "completed"].includes(status)) {
        return res.status(400).json({ error: "Estado de plan no valido" });
      }
      const plan = await TrainingPlan.findOne({
        _id: req.params.planId,
        athleteId: athlete._id.toString(),
        coachId: req.user.id,
      });
      if (!plan) return res.status(404).json({ error: "Plan no encontrado" });

      if (status === "active") {
        const otherPlans = await TrainingPlan.find(
          {
            _id: { $ne: plan._id },
            athleteId: athlete._id.toString(),
            status: "active",
          },
          "weeklySchedule.routineId",
        ).lean();
        const otherPlanIds = otherPlans.map((item) => String(item._id));
        const otherRoutineIds = otherPlans.flatMap((item) =>
          (item.weeklySchedule || [])
            .map((day) => day.routineId)
            .filter(Boolean),
        );
        await TrainingPlan.updateMany(
          { _id: { $in: otherPlanIds } },
          { $set: { status: "paused" } },
        );
        if (otherPlanIds.length || otherRoutineIds.length) {
          await Routine.updateMany(
            {
              ownerId: athlete._id.toString(),
              $or: [
                { trainingPlanId: { $in: otherPlanIds } },
                { _id: { $in: otherRoutineIds } },
              ],
            },
            { $set: { isArchived: true } },
          );
        }
      }

      plan.status = status;
      await plan.save();
      const planRoutineIds = (plan.weeklySchedule || [])
        .map((day) => day.routineId)
        .filter(Boolean);
      await Routine.updateMany(
        {
          ownerId: athlete._id.toString(),
          $or: [
            { trainingPlanId: String(plan._id) },
            { _id: { $in: planRoutineIds } },
          ],
        },
        { $set: { isArchived: status !== "active" } },
      );
      res.json(plan);
    } catch (err) {
      next(err);
    }
  },
);

router.put("/athletes/:athleteId/plans/:planId", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const plan = await TrainingPlan.findOne({
      _id: req.params.planId,
      athleteId: athlete._id.toString(),
      coachId: req.user.id,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });

    const schedule = normalizeSchedule(req.body.weeklySchedule);
    if (!schedule || !schedule.some((day) => day.type === "training")) {
      return res.status(400).json({ error: "Configura una semana valida" });
    }
    if (
      schedule.some((day) => day.type === "training" && !day.sourceRoutineId)
    ) {
      return res.status(400).json({
        error: "Asigna una rutina a cada dia de entrenamiento",
      });
    }
    const durationWeeks = Number(req.body.durationWeeks);
    if (
      !Number.isInteger(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      return res
        .status(400)
        .json({ error: "La duracion debe ser de 1 a 52 semanas" });
    }
    const name = String(req.body.name || "").trim();
    const goal = String(req.body.goal || "General").trim();
    const notes = String(req.body.notes || "").trim();
    if (!name || name.length > 100 || goal.length > 80 || notes.length > 1000) {
      return res
        .status(400)
        .json({ error: "Revisa los datos generales del plan" });
    }
    const level = PLAN_LEVELS.includes(req.body.level)
      ? req.body.level
      : plan.level;
    const strategy = PROGRESSION_STRATEGIES.includes(
      req.body.progression?.strategy,
    )
      ? req.body.progression.strategy
      : plan.progression.strategy;
    const deloadEveryWeeks =
      Number(req.body.progression?.deloadEveryWeeks) || 0;
    if (
      !Number.isInteger(deloadEveryWeeks) ||
      deloadEveryWeeks < 0 ||
      deloadEveryWeeks > 12
    ) {
      return res
        .status(400)
        .json({ error: "La descarga programada no es valida" });
    }
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (startDate && Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "La fecha de inicio no es valida" });
    }

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = await Routine.find({
      _id: { $in: sourceIds },
      ownerId: req.user.id,
      isArchived: { $ne: true },
    }).lean();
    if (sources.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "Una de las plantillas no esta disponible" });
    }

    const existingRoutines = await Routine.find({
      ownerId: athlete._id.toString(),
      trainingPlanId: String(plan._id),
    });
    const existingBySource = new Map(
      existingRoutines.map((routine) => [
        String(routine.sourceRoutineId),
        routine,
      ]),
    );
    const routineBySource = new Map();
    const selectedRoutineIds = [];
    for (const source of sources) {
      let assigned = existingBySource.get(String(source._id));
      if (!assigned) {
        assigned = new Routine({
          _id: `routine_${crypto.randomUUID()}`,
          ownerId: athlete._id.toString(),
          progressMode: "fresh",
          progressScopeId: `scope_${crypto.randomUUID()}`,
          sourceRoutineId: source._id,
          assignedByCoachId: req.user.id,
          assignedAt: new Date(),
          trainingPlanId: String(plan._id),
          assignmentType: "plan",
        });
      }
      assigned.name = source.name;
      assigned.description = source.description || "";
      assigned.branch = source.branch;
      assigned.exercises = source.exercises || [];
      assigned.isArchived = plan.status !== "active";
      await assigned.save();
      selectedRoutineIds.push(String(assigned._id));
      routineBySource.set(String(source._id), assigned._id);
    }
    await Routine.updateMany(
      {
        ownerId: athlete._id.toString(),
        trainingPlanId: String(plan._id),
        _id: { $nin: selectedRoutineIds },
      },
      { $set: { isArchived: true } },
    );

    plan.name = name;
    plan.level = level;
    plan.goal = goal;
    plan.durationWeeks = durationWeeks;
    plan.startDate = startDate;
    plan.progression = { strategy, deloadEveryWeeks };
    plan.notes = notes;
    plan.weeklySchedule = schedule.map((day) => ({
      ...day,
      sourceRoutineId: day.type === "training" ? day.sourceRoutineId : null,
      routineId:
        day.type === "training"
          ? routineBySource.get(day.sourceRoutineId)
          : null,
    }));
    await plan.save();
    res.json(plan);
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
    const alreadyAssigned = await Routine.exists({
      ownerId: athlete._id.toString(),
      sourceRoutineId: source._id,
      isArchived: { $ne: true },
    });
    if (alreadyAssigned) {
      return res.status(409).json({
        error: "Esta plantilla ya esta disponible para el atleta",
      });
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
      assignmentType: "extra",
      isArchived: false,
    });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

export default router;
