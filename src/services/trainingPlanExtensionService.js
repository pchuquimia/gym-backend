import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import { bumpCacheVersion } from "./cacheService.js";
import {
  calculatePlanExtension,
  planExtensionError,
} from "../utils/trainingPlanExtension.js";

export async function extendTrainingPlanInPlace({
  planId,
  athleteId,
  additionalWeeks,
  expectedUpdatedAt,
  expectedEndDate,
}) {
  const filter = {
    athleteId,
    coachId: null,
    $or: [{ _id: planId }, { mergedPlanIds: String(planId) }],
  };
  const snapshot = await TrainingPlan.findOne(filter).lean();
  if (!snapshot) throw planExtensionError("Planificación no encontrada", 404);
  if (
    expectedEndDate &&
    new Date(expectedEndDate).getTime() !== new Date(snapshot.endDate).getTime()
  )
    throw planExtensionError(
      "La planificación ya cambió. Actualízala antes de extenderla",
      409,
    );
  const version = expectedUpdatedAt || snapshot.updatedAt;
  const session = await TrainingPlan.startSession();
  let saved;
  try {
    await session.withTransaction(async () => {
      const plan = await TrainingPlan.findOne({
        _id: snapshot._id,
        athleteId,
        coachId: null,
      }).session(session);
      if (
        !plan ||
        new Date(plan.updatedAt).getTime() !== new Date(version).getTime()
      )
        throw planExtensionError(
          "La planificación cambió mientras se procesaba la extensión",
          409,
        );
      const extension = calculatePlanExtension(plan, additionalWeeks);
      const routineIds = [
        ...new Set(
          plan.weeklySchedule
            .filter((slot) => slot.type === "training")
            .map((slot) => slot.routineId),
        ),
      ];
      if (!routineIds.length || routineIds.some((id) => !id))
        throw planExtensionError(
          "Completa las rutinas antes de extender la planificación",
          409,
        );
      const routineCount = await Routine.countDocuments({
        _id: { $in: routineIds },
        ownerId: athleteId,
      }).session(session);
      if (routineCount !== routineIds.length)
        throw planExtensionError(
          "No se encontraron todas las rutinas de la planificación",
          409,
        );
      if (
        extension.status === "active" &&
        (await TrainingPlan.exists({
          athleteId,
          status: "active",
          _id: { $ne: plan._id },
        }).session(session))
      )
        throw planExtensionError(
          "Ya tienes otra planificación activa. Desactívala antes de reactivar esta",
          409,
        );
      Object.assign(plan, extension);
      await plan.save({ session });
      await Routine.updateMany(
        {
          ownerId: athleteId,
          _id: { $in: routineIds },
          $or: [{ trainingPlanId: String(plan._id) }, { trainingPlanId: null }],
        },
        {
          $set: {
            isArchived: plan.status !== "active",
            isAvailableForTraining: plan.status === "active",
          },
        },
        { session, runValidators: true },
      );
      saved = plan;
    });
  } finally {
    await session.endSession();
  }
  await bumpCacheVersion(`dashboard:${athleteId}`);
  return saved;
}
