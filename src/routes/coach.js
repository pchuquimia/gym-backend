import crypto from "crypto";
import { Router } from "express";
import {
  authorizeRoles,
  protect,
  requireFeature,
} from "../middleware/authMiddleware.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import PlanTemplate from "../models/PlanTemplate.js";
import Training from "../models/Training.js";
import User from "../models/User.js";
import AthleteCheckIn from "../models/AthleteCheckIn.js";
import CoachInvitation from "../models/CoachInvitation.js";
import CoachWorkflowSettings from "../models/CoachWorkflowSettings.js";
import AthleteMeasurement from "../models/AthleteMeasurement.js";
import AthleteAssessment from "../models/AthleteAssessment.js";
import CoachNotification from "../models/CoachNotification.js";
import WeightEntry from "../models/WeightEntry.js";
import Photo from "../models/Photo.js";
import UserNotification from "../models/UserNotification.js";
import { deleteCacheByPrefix } from "../services/cacheService.js";
import {
  isFuturePlan,
  syncTrainingPlanLifecycle,
} from "../utils/trainingPlanLifecycle.js";
import { transitionAthleteCoach } from "../utils/coachAssignment.js";
import {
  buildAssistedPlanDraft,
  buildWeeklyReport,
  dateKey,
  shiftDateKey,
} from "../utils/coachPremium.js";
import { PREMIUM_FEATURES } from "../utils/subscription.js";
import { persistPlanStatus } from "../services/trainingPlanTransactionService.js";
import {
  canonicalCoachCode,
  COACH_CODE_PREFIX,
  ensureCoachCode,
} from "../utils/coachCode.js";
import {
  defaultCoachWorkflow,
  normalizeFollowUp,
  normalizeIntakeQuestions,
  resolvePlanFollowUp,
} from "../utils/coachWorkflow.js";

const router = Router();
const PLAN_LEVELS = ["beginner", "intermediate", "advanced"];
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const invitationTokenHash = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const normalizeInvitationToken = (value) => {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
};

const invitationClientUrl = (token) => {
  const clientUrl = String(
    process.env.CLIENT_URL ||
      process.env.CLIENT_URLS ||
      "http://localhost:5173",
  )
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
  return `${clientUrl}/invitacion/${token}`;
};

const startCoachIntake = (athlete, coachId) => {
  const normalizedCoachId = String(coachId || "");
  athlete.coachIntake = {
    coachId: normalizedCoachId,
    settingsVersion: null,
    status: "pending",
    requestedAt: new Date(),
    submittedAt: null,
    answers: [],
  };
};

const clearCoachIntake = (athlete) => {
  athlete.coachIntake = {
    coachId: null,
    settingsVersion: null,
    status: "pending",
    requestedAt: null,
    submittedAt: null,
    answers: [],
  };
};

const notifyCoachAthleteJoined = (coachId, athlete) =>
  CoachNotification.create({
    coachId: String(coachId),
    athleteId: String(athlete._id),
    type: "athlete_joined",
    title: "Nuevo alumno vinculado",
    message: `${athlete.name || "Un alumno"} aceptó tu invitación y debe completar su evaluación inicial.`,
  });

router.get("/invitations/:token", async (req, res, next) => {
  try {
    const token = normalizeInvitationToken(req.params.token);
    if (!token) {
      return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
    }
    const invitation = await CoachInvitation.findOne({
      tokenHash: invitationTokenHash(token),
    }).lean();
    if (!invitation) {
      return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
    }
    if (invitation.status !== "pending") {
      return res.status(410).json({
        error:
          invitation.status === "accepted"
            ? "Esta invitaciÃ³n ya fue utilizada"
            : "Esta invitaciÃ³n fue cancelada",
        code: `INVITATION_${invitation.status.toUpperCase()}`,
      });
    }
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({
        error: "Esta invitaciÃ³n ha vencido",
        code: "INVITATION_EXPIRED",
      });
    }
    const coach = await User.findOne(
      {
        _id: invitation.coachId,
        role: { $in: ["Admin", "Entrenador"] },
        isActive: true,
      },
      "name role",
    ).lean();
    if (!coach) {
      return res
        .status(410)
        .json({ error: "Esta invitaciÃ³n ya no estÃ¡ disponible" });
    }
    res.set("Cache-Control", "private, no-store");
    return res.json({
      invitationId: String(invitation._id),
      coach: { name: coach.name, role: coach.role },
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    return next(error);
  }
});

router.use(protect);

const createCoachCode = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `${COACH_CODE_PREFIX}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await User.exists({ coachCode: code }))) return code;
  }
  throw new Error("No se pudo generar un código de coach");
};

router.get(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const athlete = await User.findById(
        req.user.id,
        "name assignedTrainerId trainingMode onboarding coachIntake",
      ).lean();
      const coach = athlete?.assignedTrainerId
        ? await User.findOne(
            {
              _id: athlete.assignedTrainerId,
              role: { $in: ["Admin", "Entrenador"] },
              isActive: true,
            },
            "name email role profile.avatarPhotoId",
          ).lean()
        : null;
      res.set("Cache-Control", "private, no-store");
      res.json({
        connected: Boolean(coach),
        coach,
        trainingMode: coach ? "coach_managed" : "independent",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/intake-form",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      if (!req.user.assignedTrainerId) {
        return res.status(409).json({ error: "No tienes un coach asignado" });
      }
      const settings = await CoachWorkflowSettings.findOne({
        coachId: String(req.user.assignedTrainerId),
      }).lean();
      const workflow = settings || defaultCoachWorkflow();
      res.set("Cache-Control", "private, no-store");
      return res.json({
        coachId: String(req.user.assignedTrainerId),
        version: settings?.updatedAt?.toISOString?.() || "default-v2",
        questions: normalizeIntakeQuestions(workflow.intakeQuestions).filter(
          (question) => question.enabled,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const coachCode = canonicalCoachCode(req.body.coachCode);
      if (!coachCode) {
        return res.status(400).json({ error: "Código de coach inválido" });
      }
      const coach = await User.findOne(
        {
          coachCode,
          role: { $in: ["Admin", "Entrenador"] },
          isActive: true,
        },
        "name email role profile.avatarPhotoId",
      ).lean();
      if (!coach) {
        return res.status(404).json({ error: "No encontramos ese coach" });
      }
      const athlete = await User.findById(
        req.user.id,
        "assignedTrainerId trainingMode onboarding coachIntake",
      );
      if (!athlete)
        return res.status(404).json({ error: "Usuario no encontrado" });
      const previousCoachId = String(athlete.assignedTrainerId || "");
      const nextCoachId = String(coach._id);
      if (
        previousCoachId &&
        previousCoachId !== nextCoachId &&
        req.body.confirmTransfer !== true
      ) {
        return res.status(409).json({
          error: "Confirma el cambio de coach",
          code: "COACH_TRANSFER_CONFIRMATION_REQUIRED",
        });
      }
      await transitionAthleteCoach({
        athleteId: athlete._id,
        previousCoachId,
        nextCoachId,
      });
      athlete.assignedTrainerId = nextCoachId;
      athlete.trainingMode = "coach_managed";
      athlete.onboarding.accountType = "athlete";
      startCoachIntake(athlete, nextCoachId);
      await athlete.save();
      if (previousCoachId !== nextCoachId) {
        await notifyCoachAthleteJoined(nextCoachId, athlete).catch(() => {});
      }
      res.json({ connected: true, coach, trainingMode: "coach_managed" });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/relationship",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    try {
      const athlete = await User.findById(
        req.user.id,
        "assignedTrainerId trainingMode coachIntake",
      );
      if (!athlete)
        return res.status(404).json({ error: "Usuario no encontrado" });
      await transitionAthleteCoach({
        athleteId: athlete._id,
        previousCoachId: athlete.assignedTrainerId,
        nextCoachId: null,
      });
      athlete.assignedTrainerId = null;
      athlete.trainingMode = "independent";
      clearCoachIntake(athlete);
      await athlete.save();
      res.json({ connected: false, coach: null, trainingMode: "independent" });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/invitations/:token/accept",
  authorizeRoles("Cliente"),
  async (req, res, next) => {
    let claimedInvitation = null;
    try {
      const token = normalizeInvitationToken(req.params.token);
      if (!token) {
        return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
      }
      const tokenHash = invitationTokenHash(token);
      const invitation = await CoachInvitation.findOne({ tokenHash }).lean();
      if (!invitation) {
        return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
      }
      if (
        invitation.status !== "pending" ||
        new Date(invitation.expiresAt).getTime() <= Date.now()
      ) {
        return res.status(410).json({
          error:
            invitation.status === "accepted"
              ? "Esta invitaciÃ³n ya fue utilizada"
              : invitation.status === "revoked"
                ? "Esta invitaciÃ³n fue cancelada"
                : "Esta invitaciÃ³n ha vencido",
          code: "INVITATION_UNAVAILABLE",
        });
      }
      const athlete = await User.findById(
        req.user.id,
        "name assignedTrainerId trainingMode onboarding coachIntake",
      );
      if (!athlete) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      const coach = await User.findOne(
        {
          _id: invitation.coachId,
          role: { $in: ["Admin", "Entrenador"] },
          isActive: true,
        },
        "name email role profile.avatarPhotoId",
      ).lean();
      if (!coach) {
        return res
          .status(410)
          .json({ error: "Esta invitaciÃ³n ya no estÃ¡ disponible" });
      }
      const previousCoachId = String(athlete.assignedTrainerId || "");
      const nextCoachId = String(coach._id);
      if (
        previousCoachId &&
        previousCoachId !== nextCoachId &&
        req.body.confirmTransfer !== true
      ) {
        return res.status(409).json({
          error: "Confirma el cambio de coach",
          code: "COACH_TRANSFER_CONFIRMATION_REQUIRED",
          coach: { name: coach.name },
        });
      }

      claimedInvitation = await CoachInvitation.findOneAndUpdate(
        {
          _id: invitation._id,
          status: "pending",
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "accepted",
            acceptedById: String(athlete._id),
            acceptedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!claimedInvitation) {
        return res.status(409).json({
          error: "Esta invitaciÃ³n acaba de ser utilizada",
          code: "INVITATION_ALREADY_CLAIMED",
        });
      }

      await transitionAthleteCoach({
        athleteId: athlete._id,
        previousCoachId,
        nextCoachId,
      });
      athlete.assignedTrainerId = nextCoachId;
      athlete.trainingMode = "coach_managed";
      athlete.onboarding.accountType = "athlete";
      startCoachIntake(athlete, nextCoachId);
      await athlete.save();
      await notifyCoachAthleteJoined(nextCoachId, athlete).catch(() => {});

      res.set("Cache-Control", "no-store");
      return res.json({
        connected: true,
        coach,
        trainingMode: "coach_managed",
      });
    } catch (error) {
      if (claimedInvitation?._id) {
        await CoachInvitation.updateOne(
          { _id: claimedInvitation._id, acceptedById: String(req.user.id) },
          {
            $set: { status: "pending", acceptedById: null, acceptedAt: null },
          },
        ).catch(() => {});
      }
      return next(error);
    }
  },
);

router.get(
  "/link-code",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const coachCode = await ensureCoachCode(req.user.id);
      const athleteCount = await User.countDocuments({
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      });
      res.set("Cache-Control", "private, no-store");
      res.json({ coachCode, athleteCount });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/link-code/regenerate",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const coachCode = await createCoachCode();
      await User.findByIdAndUpdate(req.user.id, { $set: { coachCode } });
      res.json({ coachCode });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/invitations",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const invitations = await CoachInvitation.find({
        coachId: String(req.user.id),
        status: "pending",
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      res.set("Cache-Control", "private, no-store");
      return res.json(
        invitations.map((invitation) => ({
          id: String(invitation._id),
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        })),
      );
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/invitations",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const invitation = await CoachInvitation.create({
        coachId: String(req.user.id),
        tokenHash: invitationTokenHash(token),
        expiresAt,
      });
      res.set("Cache-Control", "no-store");
      return res.status(201).json({
        id: String(invitation._id),
        invitationUrl: invitationClientUrl(token),
        expiresAt,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/invitations/:invitationId",
  authorizeRoles("Admin", "Entrenador"),
  async (req, res, next) => {
    try {
      if (!/^[a-f\d]{24}$/i.test(String(req.params.invitationId || ""))) {
        return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
      }
      const invitation = await CoachInvitation.findOneAndUpdate(
        {
          _id: req.params.invitationId,
          coachId: String(req.user.id),
          status: "pending",
        },
        { $set: { status: "revoked" } },
        { new: true },
      );
      if (!invitation) {
        return res.status(404).json({ error: "InvitaciÃ³n no encontrada" });
      }
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.use(authorizeRoles("Admin", "Entrenador"));

router.get("/workflow-settings", async (req, res, next) => {
  try {
    const settings = await CoachWorkflowSettings.findOne({
      coachId: String(req.user.id),
    }).lean();
    const defaults = defaultCoachWorkflow();
    res.set("Cache-Control", "private, no-store");
    return res.json({
      coachId: String(req.user.id),
      intakeQuestions: normalizeIntakeQuestions(
        settings?.intakeQuestions || defaults.intakeQuestions,
      ),
      followUp: normalizeFollowUp(settings?.followUp || defaults.followUp),
      updatedAt: settings?.updatedAt || null,
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/workflow-settings", async (req, res, next) => {
  try {
    const intakeQuestions = normalizeIntakeQuestions(req.body.intakeQuestions);
    if (!intakeQuestions.length) {
      return res.status(400).json({ error: "Agrega al menos una pregunta" });
    }
    if (!intakeQuestions.some((question) => question.enabled)) {
      return res
        .status(400)
        .json({ error: "Activa al menos una pregunta para el alumno" });
    }
    if (
      new Set(intakeQuestions.map((question) => question.key)).size !==
      intakeQuestions.length
    ) {
      return res
        .status(400)
        .json({ error: "Cada pregunta necesita un identificador único" });
    }
    const invalidChoice = intakeQuestions.find(
      (question) =>
        question.enabled &&
        ["single_choice", "multiple_choice"].includes(question.type) &&
        question.options.length < 2,
    );
    if (invalidChoice) {
      return res.status(400).json({
        error: `Agrega al menos dos opciones en “${invalidChoice.label}”`,
      });
    }
    const followUp = normalizeFollowUp(req.body.followUp);
    const settings = await CoachWorkflowSettings.findOneAndUpdate(
      { coachId: String(req.user.id) },
      { $set: { intakeQuestions, followUp } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
    res.set("Cache-Control", "no-store");
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

const athleteFilter = (coachId, athleteId) => ({
  _id: athleteId,
  role: "Cliente",
  assignedTrainerId: coachId,
  isActive: true,
});

const getAthlete = async (coachId, athleteId) =>
  User.findOne(
    athleteFilter(coachId, athleteId),
    "name email role onboarding coachIntake profile.goal profile.experienceLevel profile.weeklyFrequency profile.weight profile.height profile.healthNotes profile.avatarPhotoId",
  ).lean();

const requestToday = (value) => {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return dateKey();
  return dateKey(`${candidate}T12:00:00.000Z`) === candidate
    ? candidate
    : dateKey();
};

router.get("/notifications", async (req, res, next) => {
  try {
    const notifications = await CoachNotification.find({
      coachId: req.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.set("Cache-Control", "no-store");
    res.json({
      notifications,
      unread: notifications.filter((item) => !item.readAt).length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read", async (req, res, next) => {
  try {
    await CoachNotification.updateMany(
      { coachId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/portfolio",
  requireFeature(PREMIUM_FEATURES.COACH_PORTFOLIO),
  async (req, res, next) => {
    try {
      const athletes = await User.find(
        {
          role: "Cliente",
          assignedTrainerId: req.user.id,
          isActive: true,
        },
        "name email onboarding coachIntake profile.goal profile.experienceLevel profile.weeklyFrequency profile.weight profile.height profile.healthNotes profile.avatarPhotoId updatedAt",
      )
        .sort({ name: 1 })
        .lean();
      const athleteIds = athletes.map((athlete) => String(athlete._id));
      if (!athleteIds.length) {
        return res.json({
          generatedAt: new Date().toISOString(),
          summary: {
            athletes: 0,
            attention: 0,
            onTrack: 0,
            sessionsThisWeek: 0,
            adherence: 0,
          },
          alerts: [],
          athletes: [],
        });
      }

      const todayKey = requestToday(req.query.today);
      const historyFrom = shiftDateKey(todayKey, -34);
      const [
        trainings,
        plans,
        completedPlans,
        checkIns,
        routineCounts,
        coachWorkflow,
        finalAssessments,
      ] = await Promise.all([
        Training.find({
          ownerId: { $in: athleteIds },
          date: { $gte: historyFrom },
        })
          .select(
            "ownerId date durationSeconds totalVolume volumeBreakdown exercises",
          )
          .lean(),
        TrainingPlan.find({
          athleteId: { $in: athleteIds },
          coachId: req.user.id,
          status: { $in: ["active", "scheduled", "draft"] },
        })
          .sort({ status: 1, updatedAt: -1 })
          .lean(),
        TrainingPlan.find({
          athleteId: { $in: athleteIds },
          coachId: req.user.id,
          status: "completed",
        })
          .sort({ updatedAt: -1 })
          .lean(),
        AthleteCheckIn.find({ athleteId: { $in: athleteIds } })
          .sort({ dateKey: -1, updatedAt: -1 })
          .lean(),
        Routine.aggregate([
          {
            $match: {
              ownerId: { $in: athleteIds },
              isArchived: { $ne: true },
            },
          },
          { $group: { _id: "$ownerId", count: { $sum: 1 } } },
        ]),
        CoachWorkflowSettings.findOne({
          coachId: String(req.user.id),
        }).lean(),
        AthleteAssessment.find({
          athleteId: { $in: athleteIds },
          coachId: req.user.id,
          type: "final",
        })
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      const trainingsByAthlete = new Map();
      trainings.forEach((training) => {
        const key = String(training.ownerId);
        trainingsByAthlete.set(key, [
          ...(trainingsByAthlete.get(key) || []),
          training,
        ]);
      });
      const planByAthlete = new Map();
      plans.forEach((plan) => {
        const key = String(plan.athleteId);
        const current = planByAthlete.get(key);
        const priority = { active: 0, scheduled: 1, draft: 2 };
        if (!current || priority[plan.status] < priority[current.status]) {
          planByAthlete.set(key, plan);
        }
      });
      const completedPlanByAthlete = new Map();
      completedPlans.forEach((plan) => {
        const key = String(plan.athleteId);
        if (!completedPlanByAthlete.has(key)) {
          completedPlanByAthlete.set(key, plan);
        }
      });
      const assessmentByPlan = new Map(
        finalAssessments.map((assessment) => [
          String(assessment.planId),
          assessment,
        ]),
      );
      const checkInByAthlete = new Map();
      checkIns.forEach((checkIn) => {
        const key = String(checkIn.athleteId);
        if (!checkInByAthlete.has(key)) checkInByAthlete.set(key, checkIn);
      });
      const routineCountByAthlete = new Map(
        routineCounts.map((item) => [String(item._id), item.count]),
      );

      const enriched = athletes.map((athlete) => {
        const id = String(athlete._id);
        const athleteTrainings = trainingsByAthlete.get(id) || [];
        const athletePlan = planByAthlete.get(id) || null;
        const operationalPlan = ["active", "scheduled"].includes(
          athletePlan?.status,
        )
          ? athletePlan
          : null;
        const report = buildWeeklyReport({
          athlete,
          trainings: athleteTrainings,
          activePlan: operationalPlan,
          latestCheckIn: checkInByAthlete.get(id) || null,
          today: new Date(`${todayKey}T12:00:00.000Z`),
        });
        if (
          athlete.coachIntake?.status !== "submitted" ||
          !athlete.coachIntake?.submittedAt
        ) {
          report.alerts.unshift({
            code: "intake_pending",
            severity: "medium",
            title: "Evaluación inicial pendiente",
            detail: "El alumno todavía no envió sus respuestas iniciales.",
          });
          if (report.priority === "normal") report.priority = "medium";
        }
        if (athletePlan?.status === "draft") {
          report.alerts = report.alerts.filter(
            (alert) => alert.code !== "no_plan",
          );
          report.alerts.unshift({
            code: "plan_draft",
            severity: "medium",
            title: "Planificación en borrador",
            detail: `Continúa ${athletePlan.name} y asígnala cuando esté completa.`,
          });
          if (report.priority === "normal") report.priority = "medium";
        }
        const reviewPolicy = operationalPlan
          ? resolvePlanFollowUp(operationalPlan, coachWorkflow).review
          : null;
        if (operationalPlan && reviewPolicy?.enabled) {
          const start = new Date(operationalPlan.startDate);
          const today = new Date(`${todayKey}T12:00:00.000Z`);
          start.setUTCHours(12, 0, 0, 0);
          const elapsedWeeks = Math.max(
            0,
            Math.floor((today - start) / (7 * 86400000)),
          );
          const reviewWeek = Math.min(
            Number(operationalPlan.durationWeeks || 1),
            (Math.floor(elapsedWeeks / reviewPolicy.intervalWeeks) + 1) *
              reviewPolicy.intervalWeeks,
          );
          const reviewDate = new Date(start);
          reviewDate.setUTCDate(reviewDate.getUTCDate() + reviewWeek * 7 - 1);
          const daysUntilReview = Math.ceil((reviewDate - today) / 86400000);
          if (
            daysUntilReview >= 0 &&
            daysUntilReview <= reviewPolicy.leadDays
          ) {
            report.alerts.unshift({
              code: "plan_review_due",
              severity: "medium",
              title:
                daysUntilReview === 0
                  ? "Revisión del plan hoy"
                  : `Revisión del plan en ${daysUntilReview} días`,
              detail:
                "Revisa evaluación, fotos, medidas y adherencia antes del siguiente bloque.",
            });
            if (report.priority === "normal") report.priority = "medium";
          }
        }
        const completedPlan = completedPlanByAthlete.get(id) || null;
        const completedPlanPolicy = completedPlan
          ? resolvePlanFollowUp(completedPlan, coachWorkflow)
          : null;
        if (completedPlan && completedPlanPolicy?.finalEvaluation?.enabled) {
          const assessment = assessmentByPlan.get(String(completedPlan._id));
          if (!assessment) {
            report.alerts.unshift({
              code: "final_evaluation_pending",
              severity: "medium",
              title: "Evaluación final pendiente",
              detail: `El alumno debe cerrar ${completedPlan.name} antes del siguiente bloque.`,
            });
            if (report.priority === "normal") report.priority = "medium";
          } else {
            const submittedAt = new Date(
              `${String(assessment.dateKey).slice(0, 10)}T12:00:00.000Z`,
            );
            const daysSinceSubmission = Math.floor(
              (new Date(`${todayKey}T12:00:00.000Z`) - submittedAt) / 86400000,
            );
            if (daysSinceSubmission >= 0 && daysSinceSubmission <= 7) {
              report.alerts.unshift({
                code: "final_evaluation_received",
                severity: "medium",
                title: "Evaluación final recibida",
                detail: `Revisa las respuestas de ${completedPlan.name} y prepara el siguiente bloque.`,
              });
              if (report.priority === "normal") report.priority = "medium";
            }
          }
        }
        const sortedTrainings = [...athleteTrainings].sort((a, b) =>
          b.date.localeCompare(a.date),
        );
        return {
          ...athlete,
          id,
          routineCount: routineCountByAthlete.get(id) || 0,
          trainingCount: athleteTrainings.length,
          lastTraining: sortedTrainings[0] || null,
          weekly: report.current,
          adherence: report.adherence,
          priority: report.priority,
          alerts: report.alerts,
          readiness: report.readiness,
          planning: athletePlan
            ? {
                id: String(athletePlan._id),
                name: athletePlan.name,
                status: athletePlan.status,
                startDate: athletePlan.startDate,
              }
            : null,
        };
      });
      const allAlerts = enriched
        .flatMap((athlete) =>
          athlete.alerts.map((alert) => ({
            ...alert,
            athleteId: athlete.id,
            athleteName: athlete.name,
          })),
        )
        .sort((left, right) => (left.severity === "high" ? -1 : 1));
      const totalTarget = enriched.reduce(
        (sum, athlete) => sum + athlete.adherence.target,
        0,
      );
      const totalCompleted = enriched.reduce(
        (sum, athlete) => sum + athlete.adherence.completed,
        0,
      );
      res.set("Cache-Control", "private, no-store");
      res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          athletes: enriched.length,
          attention: enriched.filter((athlete) => athlete.priority === "high")
            .length,
          onTrack: enriched.filter((athlete) => athlete.priority === "normal")
            .length,
          sessionsThisWeek: totalCompleted,
          adherence: totalTarget
            ? Math.round(Math.min(1, totalCompleted / totalTarget) * 100)
            : 0,
        },
        alerts: allAlerts.slice(0, 20),
        athletes: enriched,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/athletes/:athleteId/weekly-report",
  requireFeature(PREMIUM_FEATURES.WEEKLY_REPORTS),
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete)
        return res.status(404).json({ error: "Atleta no encontrado" });
      const athleteId = String(athlete._id);
      const todayKey = requestToday(req.query.today);
      const from = shiftDateKey(todayKey, -34);
      const [trainings, activePlan, latestCheckIn] = await Promise.all([
        Training.find({ ownerId: athleteId, date: { $gte: from } })
          .sort({ date: -1 })
          .select(
            "date durationSeconds totalVolume volumeBreakdown exercises routineName",
          )
          .lean(),
        TrainingPlan.findOne({
          athleteId,
          coachId: req.user.id,
          status: "active",
        })
          .sort({ updatedAt: -1 })
          .lean(),
        AthleteCheckIn.findOne({ athleteId }).sort({ dateKey: -1 }).lean(),
      ]);
      res.set("Cache-Control", "private, no-store");
      res.json(
        buildWeeklyReport({
          athlete,
          trainings,
          activePlan,
          latestCheckIn,
          today: new Date(`${todayKey}T12:00:00.000Z`),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/athletes/:athleteId/plan-draft",
  requireFeature(PREMIUM_FEATURES.ASSISTED_PLANS),
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete)
        return res.status(404).json({ error: "Atleta no encontrado" });
      const athleteId = String(athlete._id);
      const [routines, trainings, latestCheckIn] = await Promise.all([
        Routine.find({ ownerId: req.user.id, isArchived: { $ne: true } })
          .sort({ updatedAt: -1 })
          .select("name goal level exercises isArchived updatedAt")
          .limit(12)
          .lean(),
        Training.find({ ownerId: athleteId })
          .sort({ date: -1 })
          .select("date routineId routineName totalVolume durationSeconds")
          .limit(100)
          .lean(),
        AthleteCheckIn.findOne({ athleteId }).sort({ dateKey: -1 }).lean(),
      ]);
      const requestedFrequency = Number(req.body.frequency);
      const draft = buildAssistedPlanDraft({
        athlete,
        routines,
        trainings,
        latestCheckIn,
        frequency: Number.isInteger(requestedFrequency)
          ? requestedFrequency
          : undefined,
        today: new Date(`${requestToday(req.body.today)}T12:00:00.000Z`),
      });
      res.json(draft);
    } catch (error) {
      next(error);
    }
  },
);

const normalizeSchedule = (value, scheduleMode = "fixed") => {
  const sequential = scheduleMode !== "fixed";
  if (
    !Array.isArray(value) ||
    (sequential ? value.length < 2 || value.length > 28 : value.length !== 7)
  )
    return null;
  let trainingOrder = 0;
  const days = value.map((day, index) => {
    const type = ["training", "rest", "recovery"].includes(day.type)
      ? day.type
      : "training";
    if (type === "training") trainingOrder += 1;
    return {
      slotId: String(day.slotId || `slot_${Number(day.dayIndex) || index + 1}`),
      order: type === "training" ? trainingOrder : index + 1,
      dayIndex: Number(day.dayIndex),
      type,
      focus: String(day.focus || "").trim(),
      sourceRoutineId:
        type === "training" && day.sourceRoutineId
          ? String(day.sourceRoutineId).trim()
          : null,
      routineId:
        type === "training" && day.routineId
          ? String(day.routineId).trim()
          : null,
    };
  });
  const indexes = new Set(days.map((day) => day.dayIndex));
  if (
    indexes.size !== days.length ||
    [...indexes].some((index) => index < 1 || index > days.length)
  ) {
    return null;
  }
  return days.sort((a, b) => a.dayIndex - b.dayIndex);
};

const normalizePlanName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");

const sameDraftStructure = (plan, candidate) => {
  const planDays = plan.weeklySchedule || [];
  const candidateDays = candidate.weeklySchedule || [];
  return (
    normalizePlanName(plan.name) === normalizePlanName(candidate.name) &&
    String(plan.scheduleMode || "fixed") ===
      String(candidate.scheduleMode || "fixed") &&
    Number(plan.durationWeeks) === Number(candidate.durationWeeks) &&
    new Date(plan.startDate).toISOString().slice(0, 10) ===
      new Date(candidate.startDate).toISOString().slice(0, 10) &&
    planDays.length === candidateDays.length &&
    planDays.every((day, index) => {
      const other = candidateDays[index];
      return (
        Number(day.dayIndex) === Number(other?.dayIndex) &&
        day.type === other?.type &&
        String(day.focus || "").trim() === String(other?.focus || "").trim() &&
        String(day.sourceRoutineId || "") ===
          String(other?.sourceRoutineId || "")
      );
    })
  );
};

const findCoachSourceRoutines = ({ coachId, sourceIds, sourcePlanId }) => {
  if (!sourceIds.length) return [];
  const availability = [{ isArchived: { $ne: true } }];
  if (sourcePlanId) {
    availability.push({ trainingPlanId: String(sourcePlanId) });
  }
  return Routine.find({
    _id: { $in: sourceIds },
    ownerId: String(coachId),
    $or: availability,
  }).lean();
};

router.get("/plan-catalog", async (req, res, next) => {
  try {
    const plans = await TrainingPlan.find({
      athleteId: req.user.id,
      coachId: null,
      status: { $ne: "cancelled" },
      $or: [
        { createdById: req.user.id },
        { createdById: null },
        { createdById: { $exists: false } },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();
    const routineIds = [
      ...new Set(
        plans.flatMap((plan) =>
          (plan.weeklySchedule || [])
            .filter((day) => day.type === "training")
            .map((day) => String(day.routineId || day.sourceRoutineId || ""))
            .filter(Boolean),
        ),
      ),
    ];
    const routines = routineIds.length
      ? await Routine.find({
          _id: { $in: routineIds },
          ownerId: req.user.id,
        }).lean()
      : [];
    const availableRoutineIds = new Set(
      routines.map((routine) => String(routine._id)),
    );
    const catalogPlans = plans.map((plan) => ({
      ...plan,
      sourcePlanId: String(plan._id),
      catalogSource: "training_plan",
      weeklySchedule: (plan.weeklySchedule || []).map((day) => {
        const routineId = String(day.routineId || day.sourceRoutineId || "");
        return {
          ...day,
          sourceRoutineId:
            day.type === "training" && availableRoutineIds.has(routineId)
              ? routineId
              : null,
        };
      }),
    }));

    res.set("Cache-Control", "private, no-store");
    res.json({ plans: catalogPlans, routines });
  } catch (err) {
    next(err);
  }
});

router.get("/plans", async (req, res, next) => {
  try {
    const athletes = await User.find(
      {
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      },
      "name email profile.avatarPhotoId",
    ).lean();
    const athleteIds = athletes.map((athlete) => String(athlete._id));
    if (!athleteIds.length) {
      res.set("Cache-Control", "private, no-store");
      return res.json([]);
    }

    const plans = await TrainingPlan.find({
      coachId: String(req.user.id),
      athleteId: { $in: athleteIds },
      status: { $ne: "cancelled" },
    })
      .sort({ updatedAt: -1 })
      .lean();
    const athleteById = new Map(
      athletes.map((athlete) => [String(athlete._id), athlete]),
    );

    res.set("Cache-Control", "private, no-store");
    return res.json(
      plans.map((plan) => {
        const athlete = athleteById.get(String(plan.athleteId));
        return {
          ...plan,
          athlete: athlete
            ? {
                id: String(athlete._id),
                name: athlete.name,
                email: athlete.email,
                avatarPhotoId: athlete.profile?.avatarPhotoId || null,
              }
            : null,
        };
      }),
    );
  } catch (err) {
    return next(err);
  }
});

router.get("/athletes", async (req, res, next) => {
  try {
    const athletes = await User.find(
      {
        role: "Cliente",
        assignedTrainerId: req.user.id,
        isActive: true,
      },
      "name email onboarding coachIntake profile.goal profile.experienceLevel profile.weeklyFrequency profile.weight profile.height profile.healthNotes profile.avatarPhotoId updatedAt",
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

router.delete("/athletes/:athleteId/relationship", async (req, res, next) => {
  try {
    const athlete = await User.findOne(
      athleteFilter(req.user.id, req.params.athleteId),
      "assignedTrainerId trainingMode coachIntake name",
    );
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    await transitionAthleteCoach({
      athleteId: athlete._id,
      previousCoachId: req.user.id,
      nextCoachId: null,
    });
    athlete.assignedTrainerId = null;
    athlete.trainingMode = "independent";
    clearCoachIntake(athlete);
    await athlete.save();
    res.json({ ok: true, athleteId: String(athlete._id) });
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
    await syncTrainingPlanLifecycle(ownerId);
    const plans = await TrainingPlan.find({
      athleteId: ownerId,
      coachId: req.user.id,
      status: { $ne: "cancelled" },
    })
      .sort({ updatedAt: -1 })
      .limit(12)
      .lean();
    const coachWorkflow = await CoachWorkflowSettings.findOne({
      coachId: String(req.user.id),
    }).lean();
    const editablePlanIds = plans
      .filter((plan) =>
        ["draft", "scheduled", "active", "paused"].includes(plan.status),
      )
      .map((plan) => String(plan._id));
    const [
      routines,
      recentTrainings,
      measurements,
      assessments,
      checkIns,
      weights,
      photos,
    ] =
      await Promise.all([
        Routine.find({
          ownerId,
          $or: [
            { isArchived: { $ne: true } },
            { trainingPlanId: { $in: editablePlanIds } },
          ],
        })
          .sort({ updatedAt: -1 })
          .select(
            "name branch exercises assignedByCoachId assignedAt trainingPlanId assignmentType isArchived isAvailableForTraining updatedAt",
          )
          .lean(),
        Training.find({ ownerId })
          .sort({ date: -1, createdAt: -1 })
          .limit(12)
          .select(
            "date routineId routineName durationSeconds totalVolume sessionType supervisedBy exercises",
          )
          .lean(),
        AthleteMeasurement.find({ athleteId: ownerId })
          .sort({ dateKey: -1 })
          .limit(12)
          .lean(),
        AthleteAssessment.find({ athleteId: ownerId })
          .sort({ dateKey: -1 })
          .limit(12)
          .lean(),
        AthleteCheckIn.find({ athleteId: ownerId })
          .sort({ dateKey: -1 })
          .limit(14)
          .lean(),
        WeightEntry.find({ ownerId })
          .sort({ dateKey: -1 })
          .limit(12)
          .lean(),
        Photo.find({
          ownerId,
          type: { $ne: "profile" },
          visibility: "coach",
        })
          .sort({ date: -1 })
          .limit(18)
          .select("date view label contentStatus")
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
      plans: plans.map((plan) => ({
        ...plan,
        effectiveFollowUp: resolvePlanFollowUp(plan, coachWorkflow),
      })),
      followUpRecords: {
        checkIns,
        weights,
        photos,
        measurements,
        assessments,
        latestMeasurement: measurements[0] || null,
        latestAssessment: assessments[0] || null,
      },
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
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }

    const scheduleMode = [
      "fixed",
      "flexible_guided",
      "sequential_cycle",
    ].includes(req.body.scheduleMode)
      ? req.body.scheduleMode
      : "fixed";
    const schedule = normalizeSchedule(req.body.weeklySchedule, scheduleMode);
    if (!schedule) {
      return res
        .status(400)
        .json({ error: "Configura una semana o ciclo valido" });
    }
    if (!schedule.some((day) => day.type === "training")) {
      return res
        .status(400)
        .json({ error: "El plan necesita al menos un dia de entrenamiento" });
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
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Selecciona una fecha de inicio" });
    }
    const nextStatus = "draft";

    const existingDrafts = await TrainingPlan.find({
      athleteId: athlete._id.toString(),
      coachId: req.user.id,
      status: "draft",
    }).lean();
    const duplicateDraft = existingDrafts.find((draft) =>
      sameDraftStructure(draft, {
        name: planName,
        scheduleMode,
        durationWeeks,
        startDate,
        weeklySchedule: schedule,
      }),
    );
    if (duplicateDraft) {
      return res.status(409).json({
        error: "Ya existe una planificación inactiva idéntica para este atleta",
        planId: duplicateDraft._id,
      });
    }

    if (req.body.planTemplateId && req.body.sourcePlanId) {
      return res.status(400).json({
        error: "Selecciona una sola fuente para la planificacion",
      });
    }
    const sourcePlan = req.body.sourcePlanId
      ? await TrainingPlan.findOne({
          _id: String(req.body.sourcePlanId),
          athleteId: req.user.id,
          coachId: null,
          status: { $ne: "cancelled" },
          $or: [
            { createdById: req.user.id },
            { createdById: null },
            { createdById: { $exists: false } },
          ],
        }).lean()
      : null;
    if (req.body.sourcePlanId && !sourcePlan) {
      return res
        .status(400)
        .json({ error: "Planificacion del catalogo no disponible" });
    }
    const planTemplate = req.body.planTemplateId
      ? await PlanTemplate.findOne({
          _id: String(req.body.planTemplateId),
          isArchived: { $ne: true },
          ownerId: req.user.id,
        }).lean()
      : null;
    if (req.body.planTemplateId && !planTemplate) {
      return res.status(400).json({ error: "Plantilla no disponible" });
    }

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = await findCoachSourceRoutines({
      coachId: req.user.id,
      sourceIds,
      sourcePlanId: sourcePlan?._id,
    });
    if (sources.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "Una de las plantillas no esta disponible" });
    }

    const plan = new TrainingPlan({
      name: planName,
      coachId: req.user.id,
      createdById: req.user.id,
      athleteId: athlete._id.toString(),
      level,
      goal: req.body.goal,
      durationWeeks,
      startDate,
      scheduleMode,
      status: nextStatus,
      planTemplateId: planTemplate?._id || null,
      planTemplateVersion: planTemplate?.version || null,
      planTemplateSnapshot: planTemplate
        ? { name: planTemplate.name, version: planTemplate.version }
        : undefined,
      sourcePlanId: sourcePlan?._id || null,
      sourcePlanSnapshot: sourcePlan
        ? { name: sourcePlan.name, updatedAt: sourcePlan.updatedAt }
        : undefined,
      notes: req.body.notes,
      followUp: {
        useCoachDefaults: req.body.followUp?.useCoachDefaults !== false,
        ...normalizeFollowUp(req.body.followUp),
      },
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
        templateGroup: source.templateGroup || "",
        goal: source.goal || "",
        level: source.level || "",
        tags: source.tags || [],
        exerciseOrderMode: source.exerciseOrderMode || "free",
        branch: req.body.branch || "general",
        exercises: source.exercises || [],
        ownerId: athlete._id.toString(),
        progressMode: "fresh",
        progressScopeId: `scope_${crypto.randomUUID()}`,
        sourceRoutineId: source._id,
        sourceRoutineVersion: Number(source.version || 1),
        kind: "assigned",
        version: 1,
        assignedByCoachId: req.user.id,
        assignedAt: new Date(),
        trainingPlanId: String(plan._id),
        assignmentType: "plan",
        isArchived: true,
        isAvailableForTraining: false,
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
    await deleteCacheByPrefix(`dashboard:${athlete._id}:`);

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
      const requestedStatus = String(req.body.status || "");
      if (!["active", "paused", "completed"].includes(requestedStatus)) {
        return res.status(400).json({ error: "Estado de plan no valido" });
      }
      const plan = await TrainingPlan.findOne({
        _id: req.params.planId,
        athleteId: athlete._id.toString(),
        coachId: req.user.id,
      });
      if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
      if (["completed", "cancelled"].includes(plan.status)) {
        return res
          .status(409)
          .json({ error: "Un plan finalizado no puede cambiar de estado" });
      }

      const allowedTransitions = {
        draft: ["active", "paused"],
        scheduled: ["active", "paused", "completed"],
        active: ["paused", "completed"],
        paused: ["active", "completed"],
      };
      if (!allowedTransitions[plan.status]?.includes(requestedStatus)) {
        return res.status(409).json({ error: "Cambio de estado no permitido" });
      }
      const status =
        requestedStatus === "active" && isFuturePlan(plan)
          ? "scheduled"
          : requestedStatus;

      if (["active", "scheduled"].includes(status)) {
        const incompleteDays = (plan.weeklySchedule || []).filter(
          (day) => day.type === "training" && !day.routineId,
        );
        if (incompleteDays.length) {
          return res.status(409).json({
            error: `Completa las rutinas de ${incompleteDays.length} ${incompleteDays.length === 1 ? "dia" : "dias"} antes de activar el plan`,
          });
        }
        const routineIds = (plan.weeklySchedule || [])
          .filter((day) => day.type === "training")
          .map((day) => day.routineId);
        const routineCount = await Routine.countDocuments({
          _id: { $in: routineIds },
          ownerId: athlete._id.toString(),
          trainingPlanId: String(plan._id),
        });
        if (routineCount !== new Set(routineIds.map(String)).size) {
          return res.status(409).json({
            error: "Una de las rutinas del plan ya no esta disponible",
          });
        }
      }
      const updatedPlan = await persistPlanStatus({
        planId: plan._id,
        athleteId: athlete._id.toString(),
        coachId: req.user.id,
        status,
        expectedUpdatedAt: plan.updatedAt,
      });
      await deleteCacheByPrefix(`dashboard:${athlete._id}:`);
      if (
        req.body.notifyAthlete !== false &&
        ["active", "scheduled"].includes(status)
      ) {
        const dateLabel = plan.startDate
          ? new Intl.DateTimeFormat("es-BO", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(plan.startDate)
          : "";
        await UserNotification.create({
          userId: String(athlete._id),
          entityId: String(plan._id),
          type: status === "scheduled" ? "plan_scheduled" : "plan_activated",
          title:
            status === "scheduled" ? "Tu plan está listo" : "Nuevo plan activo",
          message:
            status === "scheduled"
              ? `${plan.name} comenzará el ${dateLabel}.`
              : `${plan.name} ya está disponible en tu inicio.`,
        }).catch(() => {});
      }
      res.json(updatedPlan);
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
    if (["completed", "cancelled"].includes(plan.status)) {
      return res
        .status(409)
        .json({ error: "Un plan finalizado no puede editarse" });
    }

    const scheduleMode = [
      "fixed",
      "flexible_guided",
      "sequential_cycle",
    ].includes(req.body.scheduleMode)
      ? req.body.scheduleMode
      : plan.scheduleMode || "fixed";
    const schedule = normalizeSchedule(req.body.weeklySchedule, scheduleMode);
    if (!schedule || !schedule.some((day) => day.type === "training")) {
      return res.status(400).json({ error: "Configura una semana valida" });
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
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Selecciona una fecha de inicio" });
    }
    const hasCompleteRoutines = schedule
      .filter((day) => day.type === "training")
      .every((day) => day.sourceRoutineId);
    const nextStatus = hasCompleteRoutines ? plan.status : "draft";

    const sourceIds = [
      ...new Set(schedule.map((day) => day.sourceRoutineId).filter(Boolean)),
    ];
    const sources = await findCoachSourceRoutines({
      coachId: req.user.id,
      sourceIds,
      sourcePlanId: plan.sourcePlanId,
    });
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
          sourceRoutineVersion: Number(source.version || 1),
          kind: "assigned",
          version: 1,
          assignedByCoachId: req.user.id,
          assignedAt: new Date(),
          trainingPlanId: String(plan._id),
          assignmentType: "plan",
        });
      }
      assigned.name = source.name;
      assigned.description = source.description || "";
      assigned.templateGroup = source.templateGroup || "";
      assigned.goal = source.goal || "";
      assigned.level = source.level || "";
      assigned.tags = source.tags || [];
      assigned.exerciseOrderMode = source.exerciseOrderMode || "free";
      assigned.branch = req.body.branch || assigned.branch || "general";
      assigned.exercises = source.exercises || [];
      assigned.sourceRoutineVersion = Number(source.version || 1);
      assigned.isArchived = nextStatus !== "active";
      assigned.isAvailableForTraining = nextStatus === "active";
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
      { $set: { isArchived: true, isAvailableForTraining: false } },
    );

    plan.name = name;
    plan.level = level;
    plan.goal = goal;
    plan.durationWeeks = durationWeeks;
    plan.startDate = startDate;
    plan.scheduleMode = scheduleMode;
    plan.status = nextStatus;
    plan.notes = notes;
    plan.followUp = {
      useCoachDefaults: req.body.followUp?.useCoachDefaults !== false,
      ...normalizeFollowUp(req.body.followUp, plan.followUp),
    };
    plan.weeklySchedule = schedule.map((day) => ({
      ...day,
      sourceRoutineId: day.type === "training" ? day.sourceRoutineId : null,
      routineId:
        day.type === "training"
          ? routineBySource.get(day.sourceRoutineId)
          : null,
    }));
    await plan.save();
    await deleteCacheByPrefix(`dashboard:${athlete._id}:`);

    if (nextStatus === "active") {
      const otherPlans = await TrainingPlan.find(
        {
          _id: { $ne: plan._id },
          athleteId: athlete._id.toString(),
          status: "active",
        },
        "weeklySchedule.routineId",
      ).lean();
      const otherPlanIds = otherPlans.map((item) => String(item._id));
      await TrainingPlan.updateMany(
        { _id: { $in: otherPlanIds } },
        { $set: { status: "paused" } },
      );
      if (otherPlanIds.length) {
        await Routine.updateMany(
          {
            ownerId: athlete._id.toString(),
            trainingPlanId: { $in: otherPlanIds },
          },
          { $set: { isArchived: true, isAvailableForTraining: false } },
        );
      }
    } else if (nextStatus === "scheduled") {
      await TrainingPlan.updateMany(
        {
          _id: { $ne: plan._id },
          athleteId: athlete._id.toString(),
          status: "scheduled",
        },
        { $set: { status: "paused" } },
      );
    }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete("/athletes/:athleteId/plans/:planId", async (req, res, next) => {
  try {
    const athlete = await getAthlete(req.user.id, req.params.athleteId);
    if (!athlete) {
      return res.status(404).json({ error: "Atleta no encontrado" });
    }
    const ownerId = athlete._id.toString();
    const plan = await TrainingPlan.findOne({
      _id: req.params.planId,
      athleteId: ownerId,
      coachId: req.user.id,
    });
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    if (plan.status === "active") {
      return res.status(409).json({
        error: "Pausa el plan activo antes de archivarlo",
      });
    }
    if (["completed", "cancelled"].includes(plan.status)) {
      return res.status(409).json({
        error: "El historial de un plan finalizado no se puede eliminar",
      });
    }

    const hasTrainings = await Training.exists({
      ownerId,
      trainingPlanId: String(plan._id),
    });
    if (plan.status === "draft" && !hasTrainings) {
      const routines = await Routine.deleteMany({
        ownerId,
        trainingPlanId: String(plan._id),
      });
      await plan.deleteOne();
      await deleteCacheByPrefix(`dashboard:${ownerId}:`);
      return res.json({
        ok: true,
        disposition: "deleted",
        deletedRoutines: routines.deletedCount,
      });
    }

    plan.status = "cancelled";
    await Promise.all([
      plan.save(),
      Routine.updateMany(
        { ownerId, trainingPlanId: String(plan._id) },
        { $set: { isArchived: true, isAvailableForTraining: false } },
      ),
    ]);
    await deleteCacheByPrefix(`dashboard:${ownerId}:`);
    res.json({ ok: true, disposition: "archived" });
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
      $or: [
        { ownerId: req.user.id, kind: "template" },
        { ownerId: req.user.id, kind: { $exists: false } },
      ],
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
      templateGroup: source.templateGroup || "",
      goal: source.goal || "",
      level: source.level || "",
      tags: source.tags || [],
      exerciseOrderMode: source.exerciseOrderMode || "free",
      branch: req.body.branch || "general",
      exercises: source.exercises || [],
      ownerId: athlete._id.toString(),
      progressMode: "fresh",
      progressScopeId: `scope_${crypto.randomUUID()}`,
      sourceRoutineId: source._id,
      sourceRoutineVersion: Number(source.version || 1),
      kind: "assigned",
      version: 1,
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

router.post(
  "/athletes/:athleteId/routines/:routineId/duplicate",
  async (req, res, next) => {
    try {
      const athlete = await getAthlete(req.user.id, req.params.athleteId);
      if (!athlete) {
        return res.status(404).json({ error: "Atleta no encontrado" });
      }
      const source = await Routine.findOne({
        _id: req.params.routineId,
        ownerId: athlete._id.toString(),
        assignedByCoachId: req.user.id,
        isArchived: { $ne: true },
      }).lean();
      if (!source) {
        return res.status(404).json({ error: "Rutina no encontrada" });
      }
      const progressMode =
        req.body.progressMode === "inherit" ? "inherit" : "fresh";
      const routine = await Routine.create({
        _id: `routine_${crypto.randomUUID()}`,
        name: `${source.name} (Copia)`,
        description: source.description || "",
        templateGroup: source.templateGroup || "",
        goal: source.goal || "",
        level: source.level || "",
        tags: source.tags || [],
        exerciseOrderMode: source.exerciseOrderMode || "free",
        branch: req.body.branch || "general",
        exercises: source.exercises || [],
        ownerId: athlete._id.toString(),
        progressMode,
        progressScopeId:
          progressMode === "inherit" && source.progressScopeId
            ? source.progressScopeId
            : `scope_${crypto.randomUUID()}`,
        sourceRoutineId: source.sourceRoutineId || source._id,
        sourceRoutineVersion: Number(source.sourceRoutineVersion || 1),
        kind: "assigned",
        version: 1,
        assignedByCoachId: req.user.id,
        assignedAt: new Date(),
        assignmentType: "extra",
        trainingPlanId: null,
        isArchived: false,
        isAvailableForTraining: true,
      });
      res.status(201).json(routine);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
