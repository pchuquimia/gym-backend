import User from "../models/User.js";
import Exercise from "../models/Exercise.js";
import Photo from "../models/Photo.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
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

      const [
        routines,
        trainings,
        sessions,
        photos,
        preferences,
        exercises,
        plans,
        planTemplates,
        weighIns,
        hydrationEntries,
        checkIns,
        dailyMetrics,
        snapshots,
        metricJobs,
        routineAuditLogs,
        measurements,
        workflowSettings,
        assessments,
        invitations,
        notifications,
      ] = await Promise.all([
        Routine.deleteMany({ ownerId }, { session: dbSession }),
        Training.deleteMany({ ownerId }, { session: dbSession }),
        Session.deleteMany({ ownerId }, { session: dbSession }),
        Photo.deleteMany({ ownerId }, { session: dbSession }),
        Preference.deleteMany({ userId: ownerId }, { session: dbSession }),
        Exercise.deleteMany(
          { ownerId, type: "custom" },
          { session: dbSession },
        ),
        TrainingPlan.deleteMany({ athleteId: ownerId }, { session: dbSession }),
        PlanTemplate.deleteMany({ ownerId }, { session: dbSession }),
        WeightEntry.deleteMany({ ownerId }, { session: dbSession }),
        HydrationEntry.deleteMany({ ownerId }, { session: dbSession }),
        AthleteCheckIn.deleteMany(
          { athleteId: ownerId },
          { session: dbSession },
        ),
        AthleteDailyMetric.deleteMany({ ownerId }, { session: dbSession }),
        AthleteIntelligenceSnapshot.deleteMany(
          { ownerId },
          { session: dbSession },
        ),
        MetricRefreshJob.deleteMany({ ownerId }, { session: dbSession }),
        RoutineAuditLog.deleteMany({ ownerId }, { session: dbSession }),
        AthleteMeasurement.deleteMany(
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
          { session: dbSession },
        ),
        CoachWorkflowSettings.deleteMany(
          { coachId: ownerId },
          { session: dbSession },
        ),
        AthleteAssessment.deleteMany(
          { $or: [{ athleteId: ownerId }, { coachId: ownerId }] },
          { session: dbSession },
        ),
        CoachInvitation.deleteMany(
          {
            $or: [{ coachId: ownerId }, { acceptedById: ownerId }],
          },
          { session: dbSession },
        ),
        CoachNotification.deleteMany(
          { coachId: ownerId },
          { session: dbSession },
        ),
        User.updateMany(
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
        ),
      ]);

      await User.deleteOne({ _id: ownerId }, { session: dbSession });
      Object.assign(deleted, {
        routines: routines.deletedCount,
        trainings: trainings.deletedCount,
        sessions: sessions.deletedCount,
        photos: photos.deletedCount,
        preferences: preferences.deletedCount,
        exercises: exercises.deletedCount,
        plans: plans.deletedCount,
        planTemplates: planTemplates.deletedCount,
        weighIns: weighIns.deletedCount,
        hydrationEntries: hydrationEntries.deletedCount,
        checkIns: checkIns.deletedCount,
        dailyMetrics: dailyMetrics.deletedCount,
        snapshots: snapshots.deletedCount,
        metricJobs: metricJobs.deletedCount,
        routineAuditLogs: routineAuditLogs.deletedCount,
        measurements: measurements.deletedCount,
        workflowSettings: workflowSettings.deletedCount,
        assessments: assessments.deletedCount,
        invitations: invitations.deletedCount,
        notifications: notifications.deletedCount,
      });
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
