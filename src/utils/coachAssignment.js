import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";

export const transitionAthleteCoach = async ({
  athleteId,
  previousCoachId,
  nextCoachId,
}) => {
  const previousId = String(previousCoachId || "");
  const nextId = String(nextCoachId || "");
  if (!previousId || previousId === nextId) return;

  const previousPlans = await TrainingPlan.find(
    {
      athleteId: String(athleteId),
      coachId: previousId,
    },
    "status weeklySchedule.routineId",
  ).lean();
  const previousPlanIds = previousPlans.map((plan) => String(plan._id));
  const previousRoutineIds = previousPlans.flatMap((plan) =>
    (plan.weeklySchedule || [])
      .map((day) => day.routineId)
      .filter(Boolean),
  );

  const openPlanIds = previousPlans
    .filter((plan) => ["active", "scheduled"].includes(plan.status))
    .map((plan) => String(plan._id));
  if (openPlanIds.length) {
    await TrainingPlan.updateMany(
      { _id: { $in: openPlanIds } },
      { $set: { status: "paused" } },
    );
  }

  const routineFilter = {
    ownerId: String(athleteId),
    $or: [
      { assignedByCoachId: previousId },
      { trainingPlanId: { $in: previousPlanIds } },
      { _id: { $in: previousRoutineIds } },
    ],
  };
  if (nextId) {
    await Routine.updateMany(routineFilter, {
      $set: { isArchived: true, isAvailableForTraining: false },
    });
    return;
  }

  await Routine.updateMany(routineFilter, {
    $set: {
      trainingPlanId: null,
      assignmentType: "personal",
      isArchived: false,
      isAvailableForTraining: true,
    },
  });
};
