import CodexImageRequest from "../models/CodexImageRequest.js";
import Exercise from "../models/Exercise.js";
import Routine from "../models/Routine.js";
import TrainingPlan from "../models/TrainingPlan.js";
import { enqueueCodexImageRequestForExercise } from "./exerciseCodexAutoQueueService.js";

const CURRENT_PLAN_STATUSES = ["draft", "scheduled", "active", "paused"];
const ACTIVE_REQUEST_STATUSES = new Set(["pending", "processing", "ready"]);
const MASTER_INSTRUCTION_MAX_LENGTH = 12000;
const SPECIFIC_INSTRUCTION_MAX_LENGTH = 800;
const COMBINED_INSTRUCTION_MAX_LENGTH = 13000;

const exerciseImage = (exercise = {}) =>
  exercise.media?.image?.url || exercise.image || exercise.thumb || "";

export const combineImageInstructions = (master = "", specific = "") => {
  const cleanMaster = String(master || "")
    .trim()
    .slice(0, MASTER_INSTRUCTION_MAX_LENGTH);
  const cleanSpecific = String(specific || "")
    .trim()
    .slice(0, SPECIFIC_INSTRUCTION_MAX_LENGTH);
  return [
    cleanMaster ? `INSTRUCCION MAESTRA:\n${cleanMaster}` : "",
    cleanSpecific ? `AJUSTE ESPECIFICO:\n${cleanSpecific}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, COMBINED_INSTRUCTION_MAX_LENGTH);
};

export const buildExerciseImageWorkspaceItems = ({
  routines = [],
  plans = [],
  exercises = [],
  requests = [],
}) => {
  const planUsageByRoutine = new Map();
  plans.forEach((plan) => {
    (plan.weeklySchedule || []).forEach((day) => {
      const routineId = String(day.routineId || "");
      if (!routineId) return;
      if (!planUsageByRoutine.has(routineId)) {
        planUsageByRoutine.set(routineId, new Map());
      }
      planUsageByRoutine.get(routineId).set(String(plan._id), {
        id: String(plan._id),
        name: plan.name,
        status: plan.status,
      });
    });
  });

  const usageByExercise = new Map();
  const addUsage = (exerciseId, routine, alternative = false) => {
    const id = String(exerciseId || "");
    if (!id) return;
    if (!usageByExercise.has(id)) {
      usageByExercise.set(id, { routines: new Map(), plans: new Map() });
    }
    const usage = usageByExercise.get(id);
    usage.routines.set(String(routine._id), {
      id: String(routine._id),
      name: routine.name,
      alternative,
    });
    const routinePlans = planUsageByRoutine.get(String(routine._id));
    routinePlans?.forEach((plan, planId) => usage.plans.set(planId, plan));
  };

  routines.forEach((routine) => {
    (routine.exercises || []).forEach((item) => {
      addUsage(item.exerciseId, routine, false);
      (item.alternatives || []).forEach((alternative) =>
        addUsage(alternative.exerciseId, routine, true),
      );
    });
  });

  const latestRequestByExercise = new Map();
  requests.forEach((request) => {
    const id = String(request.exerciseId || "");
    if (id && !latestRequestByExercise.has(id)) {
      latestRequestByExercise.set(id, request);
    }
  });

  return exercises
    .flatMap((exercise) => {
      const id = String(exercise._id || exercise.id || "");
      const usage = usageByExercise.get(id);
      if (!usage) return [];
      const latestRequest = latestRequestByExercise.get(id);
      const routineRows = [...usage.routines.values()];
      const planRows = [...usage.plans.values()];
      return [
        {
          id,
          name: exercise.localizedNames?.es || exercise.name,
          image: exerciseImage(exercise),
          primaryMuscleGroup:
            exercise.primaryMuscleGroup ||
            exercise.primaryMuscle ||
            exercise.muscle ||
            exercise.bodyRegion ||
            "Sin clasificar",
          equipment: exercise.equipment || [],
          routineCount: routineRows.length,
          planCount: planRows.length,
          routineNames: routineRows.map((row) => row.name),
          planNames: planRows.map((row) => row.name),
          usedAsAlternative: routineRows.some((row) => row.alternative),
          inActivePlan: planRows.some((row) => row.status === "active"),
          latestRequest: latestRequest
            ? {
                id: String(latestRequest._id || latestRequest.id),
                status: latestRequest.status,
                instruction: latestRequest.instruction || "",
                active: ACTIVE_REQUEST_STATUSES.has(latestRequest.status),
                createdAt: latestRequest.createdAt,
              }
            : null,
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.inActivePlan) - Number(left.inActivePlan) ||
        right.planCount - left.planCount ||
        right.routineCount - left.routineCount ||
        left.name.localeCompare(right.name, "es"),
    );
};

export const listExerciseImageWorkspace = async ({ query = "" } = {}) => {
  const [routines, plans] = await Promise.all([
    Routine.find(
      { isArchived: { $ne: true }, isAvailableForTraining: { $ne: false } },
      "name exercises.exerciseId exercises.alternatives.exerciseId",
    ).lean(),
    TrainingPlan.find(
      { status: { $in: CURRENT_PLAN_STATUSES } },
      "name status weeklySchedule.routineId",
    ).lean(),
  ]);
  const exerciseIds = [
    ...new Set(
      routines.flatMap((routine) =>
        (routine.exercises || []).flatMap((item) => [
          item.exerciseId,
          ...(item.alternatives || []).map(
            (alternative) => alternative.exerciseId,
          ),
        ]),
      ),
    ),
  ].filter(Boolean);

  const [exercises, requests] = exerciseIds.length
    ? await Promise.all([
        Exercise.find(
          { _id: { $in: exerciseIds } },
          "name localizedNames bodyRegion primaryMuscleGroup primaryMuscle muscle equipment image thumb media.image isActive",
        ).lean(),
        CodexImageRequest.find({ exerciseId: { $in: exerciseIds } })
          .sort({ createdAt: -1 })
          .lean(),
      ])
    : [[], []];

  const normalizedQuery = String(query || "")
    .trim()
    .toLocaleLowerCase("es");
  const allItems = buildExerciseImageWorkspaceItems({
    routines,
    plans,
    exercises,
    requests,
  });
  const items = normalizedQuery
    ? allItems.filter((item) =>
        [
          item.name,
          item.primaryMuscleGroup,
          ...item.routineNames,
          ...item.planNames,
        ]
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(normalizedQuery),
      )
    : allItems;

  return {
    items,
    summary: {
      total: allItems.length,
      withImage: allItems.filter((item) => item.image).length,
      missingImage: allItems.filter((item) => !item.image).length,
      inActivePlan: allItems.filter((item) => item.inActivePlan).length,
      activeRequests: allItems.filter((item) => item.latestRequest?.active)
        .length,
    },
  };
};

export const enqueueExerciseImageWorkspaceBatch = async ({
  exerciseIds = [],
  masterInstruction = "",
  specificInstructions = {},
  requestedBy,
}) => {
  const ids = [...new Set(exerciseIds.map(String).filter(Boolean))].slice(
    0,
    50,
  );
  if (!ids.length) {
    const error = new Error("Selecciona al menos un ejercicio");
    error.statusCode = 422;
    throw error;
  }
  const exercises = await Exercise.find({ _id: { $in: ids } }).lean();
  const exerciseById = new Map(
    exercises.map((exercise) => [String(exercise._id), exercise]),
  );
  const results = [];
  for (const exerciseId of ids) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      results.push({ exerciseId, status: "error", error: "No encontrado" });
      continue;
    }
    try {
      const instruction = combineImageInstructions(
        masterInstruction,
        specificInstructions?.[exerciseId],
      );
      const queued = await enqueueCodexImageRequestForExercise({
        exercise,
        requestedBy,
        instruction,
        source: "manual",
      });
      results.push({
        exerciseId,
        requestId: String(queued.request?._id || queued.request?.id || ""),
        status: queued.reused ? "reused" : "created",
      });
    } catch (error) {
      results.push({ exerciseId, status: "error", error: error.message });
    }
  }
  return {
    results,
    created: results.filter((row) => row.status === "created").length,
    reused: results.filter((row) => row.status === "reused").length,
    failed: results.filter((row) => row.status === "error").length,
  };
};
