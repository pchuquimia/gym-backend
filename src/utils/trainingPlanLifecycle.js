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

export const classifyTrainingPlanLifecycleCandidates = (plans, today) => {
  const boundary = new Date(today).getTime();
  const candidates = Array.isArray(plans) ? plans : [];
  const expired = candidates.filter(
    (plan) =>
      plan.status === "active" &&
      plan.endDate &&
      new Date(plan.endDate).getTime() < boundary,
  );
  const duePlans = candidates
    .filter(
      (plan) =>
        plan.status === "scheduled" &&
        plan.startDate &&
        plan.endDate &&
        new Date(plan.startDate).getTime() <= boundary &&
        new Date(plan.endDate).getTime() >= boundary,
    )
    .sort((left, right) => {
      const startDifference =
        new Date(right.startDate).getTime() -
        new Date(left.startDate).getTime();
      if (startDifference) return startDifference;
      return (
        new Date(right.updatedAt || 0).getTime() -
        new Date(left.updatedAt || 0).getTime()
      );
    });
  return { expired, duePlans };
};

export async function syncTrainingPlanLifecycle(athleteId) {
  if (!athleteId) return false;
  const today = startOfTodayUtc();

  const candidates = await TrainingPlan.find(
    { athleteId, status: { $in: ["active", "scheduled"] } },
    "_id status startDate endDate updatedAt",
  ).lean();
  const { expired, duePlans } = classifyTrainingPlanLifecycleCandidates(
    candidates,
    today,
  );
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

  const nextPlan = duePlans[0];
  if (!nextPlan) return expiredIds.length > 0;

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
  return true;
}

export const isFuturePlan = (plan) => {
  if (!plan?.startDate) return false;
  return new Date(plan.startDate).getTime() > startOfTodayUtc().getTime();
};
