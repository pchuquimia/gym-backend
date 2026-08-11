import crypto from "crypto";
import Exercise from "../models/Exercise.js";
import Photo from "../models/Photo.js";
import PlanTemplate from "../models/PlanTemplate.js";
import Preference from "../models/Preference.js";
import Routine from "../models/Routine.js";
import Session from "../models/Session.js";
import Training from "../models/Training.js";
import TrainingPlan from "../models/TrainingPlan.js";
import User from "../models/User.js";
import WeightEntry from "../models/WeightEntry.js";
import { DEMO_ROLES, getDemoLifetimeHours } from "../utils/demoMode.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLE_LABELS = {
  athlete: "Atleta Demo",
  coach: "Coach Demo",
  admin: "Administrador Demo",
};

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

const addDays = (date, amount) => new Date(date.getTime() + amount * DAY_MS);

const mondayOf = (date) => {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  const weekday = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - weekday + 1);
  return result;
};

const demoId = (workspaceId, suffix) =>
  `demo_${workspaceId.replaceAll("-", "").slice(0, 12)}_${suffix}`;

const exerciseName = (exercise) =>
  exercise.localizedNames?.es || exercise.name || "Ejercicio";

const exerciseMuscle = (exercise) =>
  exercise.primaryMuscleGroup || exercise.muscle || "Cuerpo completo";

const exerciseImage = (exercise) =>
  exercise.media?.thumbnail?.url || exercise.thumb || exercise.image || "";

const routineExercise = (exercise, sets = 3) => ({
  exerciseId: String(exercise._id),
  name: exerciseName(exercise),
  sets,
  supportsUnilateral: Boolean(exercise.supportsUnilateral),
  movementMode: exercise.movementMode || "bilateral",
  muscle: exerciseMuscle(exercise),
  image: exerciseImage(exercise),
  imagePublicId: exercise.imagePublicId || "",
});

const buildSets = (exerciseIndex, trainingIndex) =>
  [0, 1, 2].map((setIndex) => {
    const weightKg =
      20 + exerciseIndex * 5 + trainingIndex * 2 + setIndex * 2.5;
    return {
      weightKg,
      reps: Math.max(6, 12 - setIndex),
      done: true,
      order: setIndex + 1,
      seriesType: "serie",
      entries: [],
    };
  });

const buildTrainingExercises = (routine, trainingIndex) =>
  routine.exercises.map((exercise, exerciseIndex) => ({
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.name,
    muscleGroup: exercise.muscle,
    primaryMuscleGroup: exercise.muscle,
    loadType: "external",
    order: exerciseIndex + 1,
    plannedOrder: exerciseIndex + 1,
    actualOrder: exerciseIndex + 1,
    movementMode: exercise.movementMode,
    sets: buildSets(exerciseIndex, trainingIndex),
  }));

const trainingVolume = (exercises) =>
  exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.reduce(
        (subtotal, set) => subtotal + set.weightKg * set.reps,
        0,
      ),
    0,
  );

const loadCatalogExercises = async () => {
  const exercises = await Exercise.find({
    type: "system",
    isActive: { $ne: false },
    mergedIntoExerciseId: null,
  })
    .sort({ image: -1, name: 1 })
    .limit(12)
    .lean();
  if (exercises.length) return exercises;
  return Exercise.find({ isActive: { $ne: false } })
    .limit(12)
    .lean();
};

const createDemoUser = async ({
  workspaceId,
  expiresAt,
  roleKey,
  suffix,
  assignedTrainerId = null,
}) => {
  const role = DEMO_ROLES[roleKey];
  const compactWorkspace = workspaceId.replaceAll("-", "").slice(0, 16);
  return User.create({
    name: suffix ? `${ROLE_LABELS[roleKey]} - ${suffix}` : ROLE_LABELS[roleKey],
    email: `demo-${roleKey}-${suffix || "principal"}-${compactWorkspace}@demo.apex.local`,
    password: `Demo#${crypto.randomUUID()}!`,
    role,
    isActive: true,
    isDemo: true,
    demoWorkspaceId: workspaceId,
    demoExpiresAt: expiresAt,
    assignedTrainerId,
    trainingMode: assignedTrainerId ? "coach_managed" : "independent",
    coachCode: ["Admin", "Entrenador"].includes(role)
      ? `DEMO-${compactWorkspace.slice(0, 8).toUpperCase()}-${suffix || "P"}`
      : undefined,
    emailVerificationRequired: false,
    profile: {
      weight: roleKey === "athlete" ? 74.8 : 80.5,
      height: roleKey === "athlete" ? 172 : 178,
      goal: "mantenimiento",
      calories: 2400,
      units: "metric",
      language: "es",
    },
  });
};

const seedOwnerWorkspace = async ({
  owner,
  workspaceId,
  exercises,
  compact = false,
}) => {
  const ownerId = owner._id.toString();
  const selected = exercises.slice(0, compact ? 6 : 9);
  const groups = [
    selected.slice(0, 3),
    selected.slice(3, 6),
    selected.slice(6, 9),
  ];
  const routineNames = ["Empuje y torso", "Piernas completas", "Full body"];
  const routines = await Routine.insertMany(
    groups
      .filter((group) => group.length)
      .map((group, index) => ({
        _id: demoId(workspaceId, `${ownerId.slice(-5)}_routine_${index + 1}`),
        name: routineNames[index],
        description: "Rutina de demostracion con datos ficticios.",
        goal: index === 1 ? "Fuerza" : "Hipertrofia",
        level: "intermediate",
        tags: [index === 1 ? "fuerza" : "hipertrofia", "demo"],
        branch: index === 1 ? "miraflores" : "sopocachi",
        exerciseOrderMode: index === 2 ? "free" : "muscle_blocks",
        exercises: group.map((exercise) => routineExercise(exercise)),
        ownerId,
        progressScopeId: demoId(
          workspaceId,
          `${ownerId.slice(-5)}_scope_${index + 1}`,
        ),
        progressMode: "inherit",
        kind: "personal",
        visibility: "private",
        isArchived: false,
        isAvailableForTraining: true,
      })),
  );

  const today = new Date();
  const planStart = addDays(mondayOf(today), -14);
  const scheduleTypes = [
    "training",
    "rest",
    "training",
    "recovery",
    "training",
    "rest",
    "rest",
  ];
  const plan = await TrainingPlan.create({
    name: "Plan demo de 8 semanas",
    athleteId: ownerId,
    createdById: ownerId,
    coachId: owner.assignedTrainerId || null,
    level: "intermediate",
    goal: "Fuerza e hipertrofia",
    durationWeeks: 8,
    startDate: planStart,
    scheduleMode: "fixed",
    status: "active",
    weeklySchedule: scheduleTypes.map((type, index) => {
      const routine =
        type === "training"
          ? routines[index === 0 ? 0 : index === 2 ? 1 : 2]
          : null;
      return {
        slotId: `slot_${index + 1}`,
        order: index + 1,
        dayIndex: index + 1,
        type,
        focus:
          routine?.name ||
          (type === "recovery" ? "Movilidad activa" : "Descanso"),
        routineId: routine?._id || null,
        sourceRoutineId: routine?._id || null,
      };
    }),
  });

  await Routine.updateMany(
    { _id: { $in: routines.map((routine) => routine._id) } },
    { $set: { trainingPlanId: plan._id.toString(), assignmentType: "plan" } },
  );

  const offsets = compact ? [-8, -3] : [-13, -9, -6, -2];
  const trainings = offsets.map((offset, trainingIndex) => {
    const routine = routines[trainingIndex % routines.length];
    const trainingExercises = buildTrainingExercises(routine, trainingIndex);
    const totalVolume = trainingVolume(trainingExercises);
    return {
      _id: demoId(
        workspaceId,
        `${ownerId.slice(-5)}_training_${trainingIndex + 1}`,
      ),
      date: dateKey(addDays(today, offset)),
      durationSeconds: 3000 + trainingIndex * 240,
      workSeconds: 2100 + trainingIndex * 180,
      restSeconds: 720,
      pauseSeconds: 180,
      totalVolume,
      volumeBreakdown: {
        recordedSets: trainingExercises.length * 3,
        completedSets: trainingExercises.length * 3,
        incompleteSets: 0,
        externalKg: totalVolume,
        machineKg: 0,
        unknownKg: 0,
        assistanceKg: 0,
        bodyweightSets: 0,
        assistedSets: 0,
        machineSets: 0,
        cardioSets: 0,
        unknownSets: 0,
      },
      routineId: routine._id,
      routineName: routine.name,
      trainingPlanId: plan._id.toString(),
      trainingPlanSlotId: `slot_${(trainingIndex % 3) * 2 + 1}`,
      progressScopeId: routine.progressScopeId,
      branch: routine.branch,
      ownerId,
      sessionType: "personal",
      startedBy: ownerId,
      exercises: trainingExercises,
    };
  });
  await Training.insertMany(trainings);

  const sessionRows = trainings.flatMap((training) =>
    training.exercises.map((exercise) => ({
      date: training.date,
      trainingId: training._id,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      routineId: training.routineId,
      routineName: training.routineName,
      sets: exercise.sets.map((set) => ({
        reps: set.reps,
        weight: set.weightKg,
      })),
      trainingDurationSeconds: training.durationSeconds,
      exerciseDurationSeconds: Math.round(
        training.durationSeconds / training.exercises.length,
      ),
      ownerId,
      sessionType: "personal",
      startedBy: ownerId,
    })),
  );
  if (sessionRows.length) await Session.insertMany(sessionRows);

  await WeightEntry.insertMany(
    [-12, -7, -3, 0].map((offset, index) => ({
      ownerId,
      dateKey: dateKey(addDays(today, offset)),
      weightKg: Number((75.6 - index * 0.25).toFixed(1)),
      note: index === 3 ? "Pesaje demo de hoy" : "",
      recordedBy: ownerId,
      source: "self",
    })),
  );
  await Preference.create({
    userId: ownerId,
    branch: "sopocachi",
    locationMode: "multiple",
    allowedBranches: ["sopocachi", "miraflores"],
  });

  return { plan, routines, trainings };
};

export const cleanupExpiredDemoWorkspaces = async () => {
  const expired = await User.find({
    isDemo: true,
    demoExpiresAt: { $lte: new Date() },
  })
    .select("demoWorkspaceId")
    .lean();
  const workspaceIds = [
    ...new Set(expired.map((user) => user.demoWorkspaceId).filter(Boolean)),
  ];
  if (!workspaceIds.length) return 0;

  await Promise.all(
    workspaceIds.map((workspaceId) => deleteDemoWorkspace(workspaceId)),
  );
  return workspaceIds.length;
};

export const deleteDemoWorkspace = async (workspaceId) => {
  if (!workspaceId) return false;

  const users = await User.find({
    isDemo: true,
    demoWorkspaceId: workspaceId,
  })
    .select("_id")
    .lean();
  const ownerIds = users.map((user) => user._id.toString());
  if (!ownerIds.length) return false;
  await Promise.all([
    Routine.deleteMany({ ownerId: { $in: ownerIds } }),
    Training.deleteMany({ ownerId: { $in: ownerIds } }),
    Session.deleteMany({ ownerId: { $in: ownerIds } }),
    Photo.deleteMany({ ownerId: { $in: ownerIds } }),
    Preference.deleteMany({ userId: { $in: ownerIds } }),
    WeightEntry.deleteMany({ ownerId: { $in: ownerIds } }),
    Exercise.deleteMany({ ownerId: { $in: ownerIds }, type: "custom" }),
    PlanTemplate.deleteMany({ ownerId: { $in: ownerIds } }),
    TrainingPlan.deleteMany({
      $or: [
        { athleteId: { $in: ownerIds } },
        { coachId: { $in: ownerIds } },
        { createdById: { $in: ownerIds } },
      ],
    }),
    User.deleteMany({ isDemo: true, demoWorkspaceId: workspaceId }),
  ]);
  return true;
};

export const createDemoWorkspace = async (roleKey) => {
  await cleanupExpiredDemoWorkspaces();
  const exercises = await loadCatalogExercises();
  if (!exercises.length) {
    const err = new Error("La demo requiere un catalogo de ejercicios cargado");
    err.statusCode = 503;
    throw err;
  }
  const workspaceId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + getDemoLifetimeHours() * 60 * 60 * 1000,
  );
  const primary = await createDemoUser({ workspaceId, expiresAt, roleKey });
  const members = [primary];

  if (roleKey === "coach") {
    members.push(
      await createDemoUser({
        workspaceId,
        expiresAt,
        roleKey: "athlete",
        suffix: "Lucia",
        assignedTrainerId: primary._id.toString(),
      }),
    );
  }
  if (roleKey === "admin") {
    const coach = await createDemoUser({
      workspaceId,
      expiresAt,
      roleKey: "coach",
      suffix: "Carlos",
    });
    const athlete = await createDemoUser({
      workspaceId,
      expiresAt,
      roleKey: "athlete",
      suffix: "Mateo",
      assignedTrainerId: primary._id.toString(),
    });
    members.push(coach, athlete);
  }

  await seedOwnerWorkspace({ owner: primary, workspaceId, exercises });
  for (const member of members
    .slice(1)
    .filter((user) => user.role === "Cliente")) {
    await seedOwnerWorkspace({
      owner: member,
      workspaceId,
      exercises,
      compact: true,
    });
  }

  return { user: primary, workspaceId, expiresAt, members };
};
