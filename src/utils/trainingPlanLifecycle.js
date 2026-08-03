import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";

const startOfTodayUtc = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
};

const setPlanRoutineAvailability = (planIds, isAvailable) => {
  if (!planIds.length) return Promise.resolve();
  return Routine.updateMany(
    { trainingPlanId: { $in: planIds } },
    {
      $set: {
        isArchived: !isAvailable,
        isAvailableForTraining: isAvailable,
      },
    },
  );
};

export async function syncTrainingPlanLifecycle(athleteId) {
  if (!athleteId) return;
  const today = startOfTodayUtc();

  const expired = await TrainingPlan.find(
    { athleteId, status: "active", endDate: { $lt: today } },
    "_id",
  ).lean();
  const expiredIds = expired.map((plan) => String(plan._id));
  if (expiredIds.length) {
    await Promise.all([
      TrainingPlan.updateMany(
        { _id: { $in: expiredIds }, status: "active" },
        { $set: { status: "completed" } },
      ),
      setPlanRoutineAvailability(expiredIds, false),
    ]);
  }

  const duePlans = await TrainingPlan.find({
    athleteId,
    status: "scheduled",
    startDate: { $lte: today },
    endDate: { $gte: today },
  })
    .sort({ startDate: -1, updatedAt: -1 })
    .lean();
  const nextPlan = duePlans[0];
  if (!nextPlan) return;

  const previousActive = await TrainingPlan.find(
    {
      athleteId,
      status: "active",
      _id: { $ne: nextPlan._id },
    },
    "_id",
  ).lean();
  const previousIds = previousActive.map((plan) => String(plan._id));
  const supersededScheduledIds = duePlans
    .slice(1)
    .map((plan) => String(plan._id));

  await Promise.all([
    TrainingPlan.updateMany(
      { _id: { $in: previousIds } },
      { $set: { status: "paused" } },
    ),
    TrainingPlan.updateMany(
      { _id: { $in: supersededScheduledIds } },
      { $set: { status: "paused" } },
    ),
    TrainingPlan.updateOne(
      { _id: nextPlan._id, status: "scheduled" },
      { $set: { status: "active" } },
    ),
    setPlanRoutineAvailability(previousIds, false),
    setPlanRoutineAvailability([String(nextPlan._id)], true),
  ]);
}

export const isFuturePlan = (plan) => {
  if (!plan?.startDate) return false;
  return new Date(plan.startDate).getTime() > startOfTodayUtc().getTime();
};
