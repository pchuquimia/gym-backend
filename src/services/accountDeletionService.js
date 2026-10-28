import User from "../models/User.js";
import Exercise from "../models/Exercise.js";
import Photo from "../models/Photo.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
import TrainingDraft from "../models/TrainingDraft.js";
import TrainingPlan from "../models/TrainingPlan.js";
import PlanTemplate from "../models/PlanTemplate.js";
import WeightEntry from "../models/WeightEntry.js";
import HydrationEntry from "../models/HydrationEntry.js";
import AthleteCheckIn from "../models/AthleteCheckIn.js";
import AthleteDailyMetric from "../models/AthleteDailyMetric.js";
import AthleteIntelligenceSnapshot from "../models/AthleteIntelligenceSnapshot.js";
import MetricRefreshJob from "../models/MetricRefreshJob.js";
import RoutineAuditLog from "../models/RoutineAuditLog.js";
import AthleteMeasurement from "../models/AthleteMeasurement.js";
import CoachWorkflowSettings from "../models/CoachWorkflowSettings.js";
import AthleteAssessment from "../models/AthleteAssessment.js";
import CoachInvitation from "../models/CoachInvitation.js";
import CoachNotification from "../models/CoachNotification.js";
import NutritionPlan from "../models/NutritionPlan.js";
import NutritionDay from "../models/NutritionDay.js";
import CoachMessage from "../models/CoachMessage.js";
import UserNotification from "../models/UserNotification.js";
import {
  processPhotoAssetCleanupJobs,
  queuePhotoAssetCleanup,
} from "./photoAssetCleanupService.js";

export const deleteAccountData = async (userId) => {
  const user = await User.findById(userId, "role assignedTrainerId").lean();
  if (!user) return null;

  const ownerId = user._id.toString();
  const formerCoachId =
    user.role === "Cliente" && user.assignedTrainerId
      ? String(user.assignedTrainerId)
      : null;
  const dbSession = await User.startSession();
  const deleted = {};
  let photoCleanupJobs = [];

  try {
    await dbSession.withTransaction(async () => {
      const storedPhotos = await Photo.find({ ownerId })
        .session(dbSession)
        .lean();
      photoCleanupJobs = await queuePhotoAssetCleanup(storedPhotos, {
        session: dbSession,
      });

      if (formerCoachId) {
        await CoachNotification.create(
          [
            {
              coachId: formerCoachId,
              type: "athlete_account_deleted",
              title: "Un alumno eliminó su cuenta",
              message:
                "La cuenta fue eliminada permanentemente y ya no forma parte de tu cartera.",
            },
          ],
          { session: dbSession },
        );
      }

      if (user.role === "Entrenador") {
        await Routine.updateMany(
          { assignedByCoachId: ownerId },
          { $set: { assignedByCoachId: null } },
          { session: dbSession, runValidators: true },
        );
        await TrainingPlan.updateMany(
          { coachId: ownerId },
          [{ $set: { coachId: null, createdById: "$athleteId" } }],
          { session: dbSession },
        );
      }

      const deletionScopes = [
        [
          "nutritionPlans",
          NutritionPlan,
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
        ],
        [
          "nutritionDays",
          NutritionDay,
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
        ],
        ["routines", Routine, { ownerId }],
        ["trainings", Training, { ownerId }],
        [
          "trainingDrafts",
          TrainingDraft,
          { $or: [{ ownerId }, { startedById: ownerId }] },
        ],
        ["sessions", Session, { ownerId }],
        ["photos", Photo, { ownerId }],
        ["preferences", Preference, { userId: ownerId }],
        ["exercises", Exercise, { ownerId, type: "custom" }],
        ["plans", TrainingPlan, { athleteId: ownerId }],
        ["planTemplates", PlanTemplate, { ownerId }],
        ["weighIns", WeightEntry, { ownerId }],
        ["hydrationEntries", HydrationEntry, { ownerId }],
        ["checkIns", AthleteCheckIn, { athleteId: ownerId }],
        ["dailyMetrics", AthleteDailyMetric, { ownerId }],
        ["snapshots", AthleteIntelligenceSnapshot, { ownerId }],
        ["metricJobs", MetricRefreshJob, { ownerId }],
        ["routineAuditLogs", RoutineAuditLog, { ownerId }],
        [
          "measurements",
          AthleteMeasurement,
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
        ],
        ["workflowSettings", CoachWorkflowSettings, { coachId: ownerId }],
        [
          "assessments",
          AthleteAssessment,
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
        ],
        [
          "invitations",
          CoachInvitation,
          { $or: [{ coachId: ownerId }, { acceptedById: ownerId }] },
        ],
        [
          "notifications",
          CoachNotification,
          {
            $or: [
              { coachId: ownerId },
              { athleteId: ownerId, type: { $ne: "athlete_account_deleted" } },
            ],
          },
        ],
        [
          "userNotifications",
          UserNotification,
          { $or: [{ userId: ownerId }, { peerId: ownerId }] },
        ],
        [
          "messages",
          CoachMessage,
          { $or: [{ senderId: ownerId }, { recipientId: ownerId }] },
        ],
      ];
      // MongoDB does not support parallel operations on one transaction session.
      for (const [name, Model, filter] of deletionScopes) {
        const result = await Model.deleteMany(filter, { session: dbSession });
        deleted[name] = result.deletedCount;
      }
      await User.updateMany(
        { assignedTrainerId: ownerId },
        {
          $set: {
            assignedTrainerId: null,
            trainingMode: "independent",
            coachIntake: {
              coachId: null,
              settingsVersion: null,
              status: "pending",
              requestedAt: null,
              submittedAt: null,
              answers: [],
            },
          },
        },
        { session: dbSession, runValidators: true },
      );

      await User.deleteOne({ _id: ownerId }, { session: dbSession });
    });
  } finally {
    await dbSession.endSession();
  }

  const photoCleanup = await processPhotoAssetCleanupJobs({
    ids: photoCleanupJobs.map((job) => job._id),
  });

  return {
    deleted,
    coachNotified: Boolean(formerCoachId),
    photoCleanupPending: photoCleanup.pending,
  };
};
