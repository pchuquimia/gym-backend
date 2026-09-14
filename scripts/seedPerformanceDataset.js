import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import { getMongoConnectionOptions } from "../src/config/db.js";
import AthleteCheckIn from "../src/models/AthleteCheckIn.js";
import AthleteDailyMetric from "../src/models/AthleteDailyMetric.js";
import CoachWorkflowSettings from "../src/models/CoachWorkflowSettings.js";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import User from "../src/models/User.js";
import WeightEntry from "../src/models/WeightEntry.js";

loadBackendEnvironment();

const ATHLETE_EMAIL_PREFIX = "perf-athlete-";
const MAX_ATHLETES = 100;
const LOCAL_CONFIRMATION = "local-only";
const STAGING_CONFIRMATION = "remote-staging";

const parseAthleteCount = (value) => {
  const parsed = Number(value || 25);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ATHLETES) {
    throw new Error(
      `La cantidad de alumnos debe estar entre 1 y ${MAX_ATHLETES}.`,
    );
  }
  return parsed;
};

const assertIsolatedPerformanceDatabase = (mongoUri) => {
  let parsed;
  try {
    parsed = new URL(mongoUri);
  } catch {
    throw new Error("MONGO_URI no es una URL valida.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = String(
    process.env.MONGO_DB_NAME ||
      parsed.pathname.replace(/^\//, "").split("?")[0],
  ).trim();
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  const isLocalRun =
    parsed.protocol === "mongodb:" &&
    isLocal &&
    process.env.PERFORMANCE_SEED_CONFIRM === LOCAL_CONFIRMATION;
  const isRemoteStagingRun =
    ["mongodb:", "mongodb+srv:"].includes(parsed.protocol) &&
    hostname.endsWith(".mongodb.net") &&
    process.env.NODE_ENV === "staging" &&
    process.env.PERFORMANCE_SEED_CONFIRM === STAGING_CONFIRMATION &&
    String(process.env.PERFORMANCE_SEED_ALLOW_REMOTE || "").toLowerCase() ===
      "true";
  if (
    (!isLocalRun && !isRemoteStagingRun) ||
    !databaseName.endsWith("_performance_test")
  ) {
    throw new Error(
      "El dataset solo puede generarse en MongoDB local o en un staging Atlas explicitamente habilitado, siempre en una base terminada en _performance_test.",
    );
  }

  return {
    databaseName,
    mode: isRemoteStagingRun ? "remote-staging" : "local",
  };
};

const dateKeyFromOffset = (offsetDays) => {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
};

const objectIdForPlan = (athleteNumber) =>
  new mongoose.Types.ObjectId(
    `70000000000000000000${athleteNumber.toString(16).padStart(4, "0")}`,
  );

const exercise = ({ id, name, muscle, weightKg, reps }) => ({
  exerciseId: id,
  exerciseName: name,
  muscleGroup: muscle,
  primaryMuscleGroup: muscle,
  loadType: "external",
  weightBasis: "total",
  order: 1,
  plannedOrder: 1,
  actualOrder: 1,
  sets: Array.from({ length: 3 }, (_, index) => ({
    weightKg,
    reps,
    done: true,
    order: index + 1,
    seriesType: "serie",
    entries: [],
  })),
});

const seed = async () => {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  const { databaseName, mode } = assertIsolatedPerformanceDatabase(mongoUri);
  const athleteCount = parseAthleteCount(process.argv[2]);
  const password = String(process.env.PERFORMANCE_TEST_PASSWORD || "");
  if (password.length < 12) {
    throw new Error(
      "Configura PERFORMANCE_TEST_PASSWORD con al menos 12 caracteres; no se guarda en el repositorio.",
    );
  }

  await mongoose.connect(mongoUri, getMongoConnectionOptions());
  const coachEmail = String(
    mode === "remote-staging"
      ? process.env.PERFORMANCE_ADMIN_EMAIL || "perf-admin@example.invalid"
      : process.env.DEV_ADMIN_EMAIL || "admin@gym.com",
  ).toLowerCase();
  let coach = await User.findOne({ email: coachEmail }).select("+password");
  if (mode === "remote-staging") {
    if (!coach) {
      coach = new User({
        name: "Administrador de rendimiento",
        email: coachEmail,
        password,
        role: "Admin",
        isActive: true,
      });
    } else {
      coach.name = "Administrador de rendimiento";
      coach.password = password;
      coach.role = "Admin";
      coach.isActive = true;
      coach.failedLoginAttempts = 0;
      coach.lockUntil = null;
    }
    await coach.save();
  } else if (!coach || coach.role !== "Admin") {
    throw new Error(
      "Primero inicia una vez POST /api/auth/dev-admin en esta misma base local.",
    );
  }

  const coachId = String(coach._id);
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const athleteEmailPattern = new RegExp(
    `^${ATHLETE_EMAIL_PREFIX}\\d{3}@example\\.invalid$`,
  );

  // En cada escala solo permanecen activos los alumnos solicitados. El filtro
  // esta limitado a las cuentas sinteticas de esta base local aislada.
  await User.updateMany(
    { email: athleteEmailPattern },
    { $set: { isActive: false } },
  );

  const athleteOperations = Array.from({ length: athleteCount }, (_, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(3, "0");
    return {
      updateOne: {
        filter: { email: `${ATHLETE_EMAIL_PREFIX}${suffix}@example.invalid` },
        update: {
          $set: {
            name: `Atleta Prueba ${suffix}`,
            username: `perf_atleta_${suffix}`,
            password: passwordHash,
            role: "Cliente",
            isActive: true,
            assignedTrainerId: coachId,
            trainingMode: "coach_managed",
            onboarding: {
              accountType: "athlete",
              status: "complete",
              completedAt: now,
            },
            coachIntake: {
              coachId,
              settingsVersion: "performance-v1",
              status: "submitted",
              requestedAt: now,
              submittedAt: now,
              answers: [],
            },
            profile: {
              birthDate: "1992-06-15",
              weight: 68 + (number % 18),
              height: 160 + (number % 28),
              goal: number % 3 === 0 ? "definicion" : "volumen",
              experienceLevel: number % 4 === 0 ? "advanced" : "intermediate",
              weeklyFrequency: 3,
              calories: 2200 + (number % 6) * 100,
              hydrationGoalMl: 2500,
              healthNotes: "",
              units: "metric",
              language: "es",
              privacy: "privado",
            },
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    };
  });
  await User.bulkWrite(athleteOperations, { ordered: false });

  const athletes = await User.find({
    email: athleteEmailPattern,
    isActive: true,
    assignedTrainerId: coachId,
  })
    .sort({ email: 1 })
    .select("_id email")
    .lean();

  await CoachWorkflowSettings.findOneAndUpdate(
    { coachId },
    { $setOnInsert: { coachId } },
    { upsert: true, setDefaultsOnInsert: true, new: true },
  );

  const routineOperations = [];
  const planOperations = [];
  const trainingOperations = [];
  const checkInOperations = [];
  const weightOperations = [];
  const metricOperations = [];
  const startDate = new Date(`${dateKeyFromOffset(-21)}T12:00:00.000Z`);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 8 * 7 - 1);

  athletes.forEach((athlete, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(3, "0");
    const athleteId = String(athlete._id);
    const planId = objectIdForPlan(number);
    const routineIds = [1, 2, 3].map(
      (slot) => `perf-routine-${suffix}-${slot}`,
    );
    const routineNames = ["Piernas y gluteos", "Tren superior", "Full body"];

    routineIds.forEach((routineId, routineIndex) => {
      routineOperations.push({
        updateOne: {
          filter: { _id: routineId },
          update: {
            $set: {
              name: routineNames[routineIndex],
              description:
                "Rutina sintetica para pruebas locales de rendimiento.",
              goal: "Hipertrofia",
              level: "intermediate",
              tags: ["performance-test"],
              branch: "sopocachi",
              exercises: [],
              ownerId: athleteId,
              progressScopeId: `perf-scope-${suffix}-${routineIndex + 1}`,
              kind: "assigned",
              visibility: "private",
              assignedByCoachId: coachId,
              assignedAt: now,
              trainingPlanId: String(planId),
              trainingPlanSlotId: `slot_${routineIndex * 2 + 1}`,
              assignmentType: "plan",
              isArchived: false,
              isAvailableForTraining: true,
            },
          },
          upsert: true,
        },
      });
    });

    const weeklySchedule = Array.from({ length: 7 }, (_, dayIndex) => {
      const routineIndex = [0, 2, 4].indexOf(dayIndex);
      return {
        slotId: `slot_${dayIndex + 1}`,
        order: routineIndex >= 0 ? routineIndex + 1 : dayIndex + 1,
        dayIndex: dayIndex + 1,
        type: routineIndex >= 0 ? "training" : "rest",
        focus: routineIndex >= 0 ? routineNames[routineIndex] : "Descanso",
        sourceRoutineId: null,
        routineId: routineIndex >= 0 ? routineIds[routineIndex] : null,
      };
    });
    planOperations.push({
      updateOne: {
        filter: { _id: planId },
        update: {
          $set: {
            name: `Hipertrofia - Bloque ${suffix}`,
            coachId,
            createdById: coachId,
            athleteId,
            level: "intermediate",
            goal: "Hipertrofia",
            durationWeeks: 8,
            startDate,
            endDate,
            scheduleMode: "fixed",
            frequencyTarget: 3,
            status: "active",
            weeklySchedule,
            notes: "Plan sintetico para pruebas locales de rendimiento.",
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });

    const trainingOffsets = [
      -34, -32, -30, -27, -25, -23, -20, -18, -16, -13, -11, -9, -6, -4, -2,
    ];
    trainingOffsets.forEach((offset, trainingIndex) => {
      const date = dateKeyFromOffset(offset);
      const routineIndex = trainingIndex % 3;
      const weightKg = 42 + (number % 12) + trainingIndex;
      const totalVolume = weightKg * 30;
      const trainingId = `perf-training-${suffix}-${String(trainingIndex + 1).padStart(2, "0")}`;
      trainingOperations.push({
        updateOne: {
          filter: { _id: trainingId },
          update: {
            $set: {
              date,
              durationSeconds: 2700 + (trainingIndex % 4) * 300,
              totalVolume,
              volumeBreakdown: {
                recordedSets: 3,
                completedSets: 3,
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
              routineId: routineIds[routineIndex],
              routineName: routineNames[routineIndex],
              registrationKey: trainingId,
              trainingPlanId: String(planId),
              trainingPlanSlotId: `slot_${routineIndex * 2 + 1}`,
              progressScopeId: `perf-scope-${suffix}-${routineIndex + 1}`,
              ownerId: athleteId,
              sessionType: "personal",
              startedBy: athleteId,
              exercises: [
                exercise({
                  id: `perf-exercise-${routineIndex + 1}`,
                  name: routineNames[routineIndex],
                  muscle: routineIndex === 0 ? "Piernas" : "Pecho",
                  weightKg,
                  reps: 10,
                }),
              ],
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
      metricOperations.push({
        updateOne: {
          filter: { ownerId: athleteId, dateKey: date },
          update: {
            $set: {
              sessionCount: 1,
              durationSeconds: 2700 + (trainingIndex % 4) * 300,
              totalVolume,
              recordedSets: 3,
              completedSets: 3,
              exerciseCount: 1,
              muscleGroups: [routineIndex === 0 ? "Piernas" : "Pecho"],
              sourceUpdatedAt: now,
            },
          },
          upsert: true,
        },
      });
    });

    [-28, -21, -14, -7, 0].forEach((offset, checkInIndex) => {
      const dateKey = dateKeyFromOffset(offset);
      const readinessScore = 70 + ((number + checkInIndex) % 24);
      checkInOperations.push({
        updateOne: {
          filter: { athleteId, dateKey },
          update: {
            $set: {
              sleep: 3 + ((number + checkInIndex) % 3),
              energy: 3 + ((number + checkInIndex + 1) % 3),
              stress: 1 + ((number + checkInIndex) % 3),
              soreness: 1 + ((number + checkInIndex + 1) % 3),
              motivation: 3 + ((number + checkInIndex + 2) % 3),
              jointPain: 1,
              painAreas: [],
              notes: "",
              readinessScore,
              readinessState: readinessScore >= 78 ? "ready" : "adjust",
              submittedBy: athleteId,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
      weightOperations.push({
        updateOne: {
          filter: { ownerId: athleteId, dateKey },
          update: {
            $set: {
              weightKg: 68 + (number % 18) - checkInIndex * 0.15,
              note: "",
              recordedBy: athleteId,
              source: "self",
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    });
  });

  const batches = [
    [Routine, routineOperations],
    [TrainingPlan, planOperations],
    [Training, trainingOperations],
    [AthleteCheckIn, checkInOperations],
    [WeightEntry, weightOperations],
    [AthleteDailyMetric, metricOperations],
  ];
  for (const [Model, operations] of batches) {
    if (operations.length)
      await Model.bulkWrite(operations, { ordered: false });
  }

  console.log(
    JSON.stringify({
      database: databaseName,
      mode,
      coach: coachEmail,
      activeAthletes: athletes.length,
      routines: routineOperations.length,
      activePlans: planOperations.length,
      trainings: trainingOperations.length,
      checkIns: checkInOperations.length,
      weighIns: weightOperations.length,
    }),
  );
};

try {
  await seed();
} finally {
  await mongoose.disconnect();
}
