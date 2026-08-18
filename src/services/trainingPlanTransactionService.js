import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";

const conflict = (message) => {
  const error = new Error(message);
  error.status = 409;
  error.code = "PLAN_CONCURRENT_UPDATE";
  return error;
};

export const persistPlanStatus = async ({
  planId,
  athleteId,
  coachId,
  status,
  expectedUpdatedAt,
}) => {
  const dbSession = await TrainingPlan.startSession();
  let updatedPlan = null;

  try {
    await dbSession.withTransaction(async () => {
      const filter = { _id: planId, athleteId };
      filter.coachId = coachId || null;
      const plan = await TrainingPlan.findOne(filter).session(dbSession);
      if (!plan) throw conflict("El plan ya no esta disponible");
      if (
        expectedUpdatedAt &&
        new Date(plan.updatedAt).getTime() !==
          new Date(expectedUpdatedAt).getTime()
      ) {
        throw conflict("El plan cambio mientras se procesaba la solicitud");
      }

      if (status === "active") {
        const previous = await TrainingPlan.find(
          {
            _id: { $ne: plan._id },
            athleteId,
            status: "active",
          },
          "_id",
        )
          .session(dbSession)
          .lean();
        const previousIds = previous.map((item) => String(item._id));
        if (previousIds.length) {
          await TrainingPlan.updateMany(
            { _id: { $in: previousIds } },
            { $set: { status: "paused" } },
            { session: dbSession, runValidators: true },
          );
          await Routine.updateMany(
            { ownerId: athleteId, trainingPlanId: { $in: previousIds } },
            { $set: { isArchived: true, isAvailableForTraining: false } },
            { session: dbSession, runValidators: true },
          );
        }
      } else if (status === "scheduled") {
        await TrainingPlan.updateMany(
          {
            _id: { $ne: plan._id },
            athleteId,
            status: "scheduled",
          },
          { $set: { status: "paused" } },
          { session: dbSession, runValidators: true },
        );
      }

      plan.status = status;
      await plan.save({ session: dbSession });
      await Routine.updateMany(
        { ownerId: athleteId, trainingPlanId: String(plan._id) },
        {
          $set: {
            isArchived: status !== "active",
            isAvailableForTraining: status === "active",
          },
        },
        { session: dbSession, runValidators: true },
      );
      updatedPlan = plan;
    });
    return updatedPlan;
  } finally {
    await dbSession.endSession();
  }
};
