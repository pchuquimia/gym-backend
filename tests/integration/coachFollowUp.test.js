import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";
import User from "../../src/models/User.js";
import TrainingPlan from "../../src/models/TrainingPlan.js";
import CoachWorkflowSettings from "../../src/models/CoachWorkflowSettings.js";
import WeightEntry from "../../src/models/WeightEntry.js";
import Photo from "../../src/models/Photo.js";
import { normalizeFollowUp } from "../../src/utils/coachWorkflow.js";
import { resetAuthenticationUserCache } from "../../src/services/authenticationUserCache.js";

let database;
let coach;
let athlete;
let plan;
const previousSecret = process.env.JWT_SECRET;
const today = "2026-10-29";
const policy = (overrides = {}) =>
  normalizeFollowUp({
    checkIn: { enabled: false },
    weight: { enabled: false },
    photos: { enabled: false },
    measurements: { enabled: false },
    finalEvaluation: { enabled: false },
    ...overrides,
  });
const token = (user) =>
  `Bearer ${jwt.sign({ id: user.id, sid: "follow-up-test" }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
const dashboard = (date = today) =>
  request(app)
    .get(`/api/dashboard/bootstrap/core?today=${date}`)
    .set("Authorization", token(athlete));
const saveWorkflow = (followUp) =>
  request(app)
    .put("/api/coach/workflow-settings")
    .set("Authorization", token(coach))
    .send({
      intakeQuestions: [
        {
          key: "goal",
          label: "Tu objetivo",
          type: "short_text",
          enabled: true,
          required: true,
        },
      ],
      followUp,
    });

beforeAll(async () => {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1, ip: "127.0.0.1" },
  });
  await mongoose.connect(database.getUri("rirfit_follow_up_test"));
  await Promise.all(
    Object.values(mongoose.models).map((Model) => Model.init()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
beforeEach(async () => {
  resetAuthenticationUserCache();
  for (const Model of Object.values(mongoose.models))
    await Model.deleteMany({});
  const account = (extra) =>
    User.create({
      name: "Atleta de prueba",
      email: `${crypto.randomUUID()}@example.invalid`,
      password: crypto.randomBytes(32).toString("hex"),
      activeSessions: [{ sessionId: "follow-up-test" }],
      ...extra,
    });
  coach = await account({ role: "Entrenador" });
  athlete = await account({
    assignedTrainerId: coach.id,
    trainingMode: "coach_managed",
  });
  plan = await TrainingPlan.create({
    name: "Bloque de fuerza",
    athleteId: athlete.id,
    coachId: coach.id,
    startDate: "2026-10-01",
    endDate: "2027-12-31",
    durationWeeks: 65,
    frequencyTarget: 3,
    scheduleMode: "fixed",
    status: "active",
    weeklySchedule: [
      {
        slotId: "lower-a",
        order: 1,
        dayIndex: 4,
        type: "training",
        routineId: "lower-a",
      },
    ],
    followUp: { ...policy(), useCoachDefaults: true },
  });
});

test("el dashboard respeta las tareas del coach y actualiza la respuesta en caché al editarlas", async () => {
  await saveWorkflow(
    policy({
      checkIn: { enabled: true, cadence: "daily" },
      weight: {
        enabled: true,
        frequencyUnit: "day",
        frequencyInterval: 1,
        required: true,
      },
      photos: {
        enabled: true,
        frequencyUnit: "day",
        frequencyInterval: 7,
        views: ["front"],
        required: false,
      },
    }),
  ).expect(200);
  const first = await dashboard().expect(200);
  expect(first.body.followUp.missions.map((mission) => mission.type)).toEqual([
    "check_in",
    "weight",
    "photos",
  ]);
  expect(first.body.followUp.missions[2]).toMatchObject({
    required: false,
    views: ["front"],
  });
  expect((await dashboard().expect(200)).headers["x-data-cache"]).toBe(
    "BOOTSTRAP-CORE-HIT",
  );
  await saveWorkflow(
    policy({
      measurements: {
        enabled: true,
        frequencyUnit: "day",
        frequencyInterval: 1,
        fields: ["waist", "arm"],
        required: true,
      },
    }),
  ).expect(200);
  const changed = await dashboard().expect(200);
  expect(changed.headers["x-data-cache"]).toBe("BOOTSTRAP-CORE-MISS");
  expect(changed.body.followUp.missions).toEqual([
    expect.objectContaining({
      type: "measurements",
      fields: ["waist", "arm"],
      required: true,
    }),
  ]);
  await request(app)
    .post("/api/measurements")
    .set("Authorization", token(athlete))
    .send({ dateKey: today, values: { waist: 80 } })
    .expect(201);
  expect(
    (await dashboard().expect(200)).body.followUp.missions[0],
  ).toMatchObject({ completed: false, subtitle: "1 medida pendiente" });
  await request(app)
    .post("/api/measurements")
    .set("Authorization", token(athlete))
    .send({ dateKey: today, values: { waist: 80, arm: 32 } })
    .expect(201);
  expect(
    (await dashboard().expect(200)).body.followUp.missions[0],
  ).toMatchObject({ completed: true, subtitle: "Registradas hoy" });
});

test("mantiene visibles los registros asignados entre fechas y oculta los desactivados", async () => {
  await saveWorkflow(
    policy({
      photos: {
        enabled: true,
        frequencyUnit: "day",
        frequencyInterval: 7,
        views: ["front"],
      },
    }),
  ).expect(200);
  expect(
    (await dashboard("2026-10-30").expect(200)).body.followUp.missions,
  ).toEqual([
    expect.objectContaining({
      type: "photos",
      dueToday: false,
      nextDueDate: "2026-11-05",
    }),
  ]);
  expect(
    (await dashboard(today).expect(200)).body.followUp.missions.map(
      (mission) => mission.type,
    ),
  ).toEqual(["photos"]);
  expect(
    (await dashboard(today).expect(200)).body.followUp.missions[0],
  ).toMatchObject({ dueToday: true, nextDueDate: today });
  await saveWorkflow(policy()).expect(200);
  expect((await dashboard().expect(200)).body.followUp.missions).toEqual([]);
});

test("la configuración personalizada del alumno prevalece sobre la general del coach", async () => {
  await TrainingPlan.updateOne(
    { _id: plan._id },
    {
      $set: {
        followUp: {
          ...policy({
            measurements: {
              enabled: true,
              frequencyUnit: "day",
              frequencyInterval: 1,
              fields: ["arm"],
            },
          }),
          useCoachDefaults: false,
        },
      },
    },
  );
  await saveWorkflow(
    policy({
      weight: { enabled: true, frequencyUnit: "day", frequencyInterval: 1 },
    }),
  ).expect(200);
  const result = await dashboard().expect(200);
  expect(result.body.followUp.missions).toEqual([
    expect.objectContaining({ type: "measurements", fields: ["arm"] }),
  ]);
  expect(
    await CoachWorkflowSettings.countDocuments({ coachId: coach.id }),
  ).toBe(1);
});

test("el check-in asignado se puede completar sin suscripción y se refleja en seguimiento", async () => {
  await saveWorkflow(
    policy({ checkIn: { enabled: true, cadence: "daily" } }),
  ).expect(200);
  expect(
    (await dashboard().expect(200)).body.followUp.missions[0],
  ).toMatchObject({ type: "check_in", completed: false });
  await request(app)
    .post("/api/check-ins")
    .set("Authorization", token(athlete))
    .send({
      dateKey: today,
      sleep: 4,
      energy: 4,
      stress: 2,
      soreness: 2,
      motivation: 4,
      jointPain: 1,
    })
    .expect(201);
  expect(
    (await dashboard().expect(200)).body.followUp.missions[0],
  ).toMatchObject({ type: "check_in", completed: true });
});

test("el atleta activa y desactiva el agua como preferencia propia sin asignarse una tarea del coach", async () => {
  await saveWorkflow(policy()).expect(200);
  const initial = await dashboard().expect(200);
  expect(initial.body.profile.profile.hydrationTrackingEnabled).toBe(false);
  for (const enabled of [true, false]) {
    const saved = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", token(athlete))
      .send({ hydrationTrackingEnabled: enabled })
      .expect(200);
    expect(saved.body.profile.hydrationTrackingEnabled).toBe(enabled);
    const fresh = await dashboard().expect(200);
    expect(fresh.body.profile.profile.hydrationTrackingEnabled).toBe(enabled);
    expect(fresh.body.followUp.missions).toEqual([]);
    expect(
      (await User.findById(athlete.id)).profile.hydrationTrackingEnabled,
    ).toBe(enabled);
  }
  await request(app)
    .patch("/api/auth/profile")
    .set("Authorization", token(athlete))
    .send({ hydrationTrackingEnabled: "invalid" })
    .expect(400);
});

test("las tarjetas del coach reciben el total real aunque la ficha limite el historial reciente", async () => {
  await WeightEntry.insertMany(
    Array.from({ length: 18 }, (_, index) => ({
      ownerId: athlete.id,
      recordedBy: athlete.id,
      dateKey: `2026-10-${String(index + 1).padStart(2, "0")}`,
      weightKg: 70 + index * 0.1,
    })),
  );
  await WeightEntry.create({
    ownerId: coach.id,
    recordedBy: coach.id,
    dateKey: today,
    weightKg: 80,
  });
  await Photo.insertMany([
    {
      ownerId: athlete.id,
      date: today,
      visibility: "coach",
      type: "home",
      view: "front",
    },
    {
      ownerId: athlete.id,
      date: today,
      visibility: "private",
      type: "home",
      view: "front",
    },
    {
      ownerId: athlete.id,
      date: today,
      visibility: "coach",
      type: "profile",
      view: "front",
    },
  ]);
  const result = await request(app)
    .get(`/api/coach/athletes/${athlete.id}/overview`)
    .set("Authorization", token(coach))
    .expect(200);
  expect(result.body.followUpRecords.weights).toHaveLength(12);
  expect(result.body.followUpRecords.photos).toHaveLength(1);
  expect(result.body.followUpRecords.counts).toEqual({
    weights: 18,
    photos: 1,
    measurements: 0,
    assessments: 0,
    checkIns: 0,
  });
  expect(result.body.followUpRecords.weights[0].dateKey).toBe("2026-10-18");
});
