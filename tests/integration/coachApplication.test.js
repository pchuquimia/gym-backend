import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";
import User from "../../src/models/User.js";
import { resetAuthenticationUserCache } from "../../src/services/authenticationUserCache.js";

let database;
const previousSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri("rirfit_coach_application_test"));
  await User.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
beforeEach(async () => {
  resetAuthenticationUserCache();
  await User.deleteMany({});
});
const account = (extra = {}) =>
  User.create({
    name: "Beta User",
    email: `${crypto.randomUUID()}@example.invalid`,
    password: crypto.randomBytes(32).toString("hex"),
    activeSessions: [{ sessionId: "coach-test" }],
    ...extra,
  });
const token = (user) =>
  `Bearer ${jwt.sign({ id: user.id, sid: "coach-test" }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
const application = {
  experience: "Tengo cinco años de experiencia",
  intendedUse: "Planificar las rutinas de mis alumnos",
};
const submit = (user, payload = application) =>
  request(app)
    .post("/api/users/coach-application")
    .set("Authorization", token(user))
    .send(payload);
const review = (admin, user, decision, reason = "") =>
  request(app)
    .patch(`/api/users/${user.id}`)
    .set("Authorization", token(admin))
    .send({ coachApplicationDecision: decision, reason });

test("a request stays an athlete, is visible to the admin and persists through session refresh", async () => {
  const user = await account();
  const admin = await account({ role: "Admin" });
  await submit(user, {
    ...application,
    role: "Entrenador",
    coachApplication: { status: "approved" },
  }).expect(201);
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", token(user))
    .expect(200);
  expect(me.body.user.role).toBe("Cliente");
  expect(me.body.user.coachApplication.status).toBe("pending");
  const list = await request(app)
    .get("/api/users")
    .set("Authorization", token(admin))
    .expect(200);
  expect(
    list.body.find((row) => row._id === user.id).coachApplication.experience,
  ).toBe(application.experience);
  await submit(user).expect(409);
});

test("clients cannot grant themselves coach access or review requests", async () => {
  const user = await account({ onboarding: { status: "pending" } });
  await request(app)
    .patch("/api/auth/onboarding/account-type")
    .set("Authorization", token(user))
    .send({ accountType: "coach" })
    .expect(403);
  await request(app)
    .patch("/api/auth/onboarding/coach")
    .set("Authorization", token(user))
    .send({ name: "Beta User", username: "beta_user" })
    .expect(403);
  await submit(user).expect(201);
  await review(user, user, "approved").expect(403);
  expect((await User.findById(user.id)).role).toBe("Cliente");
});

test("approval grants coach tools on the same account and cannot be applied twice", async () => {
  const user = await account();
  const admin = await account({ role: "Admin" });
  await submit(user).expect(201);
  const result = await review(admin, user, "approved").expect(200);
  expect(result.body.role).toBe("Entrenador");
  expect(result.body.coachApplication.status).toBe("approved");
  const saved = await User.findById(user.id);
  expect(saved.coachCode).toMatch(/^RIRFIT-/);
  expect(saved.coachApplication.reviewedBy).toBe(admin.id);
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", token(user))
    .expect(200);
  expect(me.body.user.role).toBe("Entrenador");
  await review(admin, user, "rejected", "Fuera de plazo").expect(409);
});

test("rejection requires a reason, preserves the account and allows resubmission", async () => {
  const user = await account();
  const admin = await account({ role: "Admin" });
  await submit(user).expect(201);
  await review(admin, user, "rejected").expect(400);
  await review(
    admin,
    user,
    "rejected",
    "Necesitamos más detalle sobre tu experiencia",
  ).expect(200);
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", token(user))
    .expect(200);
  expect(me.body.user.role).toBe("Cliente");
  expect(me.body.user.coachApplication.reason).toContain("más detalle");
  await submit(user).expect(201);
  const saved = await User.findById(user.id);
  expect(saved.coachApplication.reviewedBy).toBeNull();
  expect(saved.coachApplication.reason).toBe("");
});

test("simultaneous reviews resolve a pending application only once", async () => {
  const user = await account();
  const admin = await account({ role: "Admin" });
  await submit(user).expect(201);
  const results = await Promise.all([
    review(admin, user, "approved"),
    review(admin, user, "rejected", "Cupo completo"),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
});

test("validates applications and restricts them to authenticated athletes", async () => {
  const user = await account();
  const coach = await account({ role: "Entrenador" });
  await submit(user, { experience: "corto", intendedUse: "corto" }).expect(400);
  await submit(coach).expect(403);
  await request(app)
    .post("/api/users/coach-application")
    .send(application)
    .expect(401);
  expect((await User.findById(user.id)).coachApplication.status).toBe("none");
});

test("approval ends an existing coach relationship on the same account", async () => {
  const coach = await account({ role: "Entrenador" });
  const user = await account({
    assignedTrainerId: coach.id,
    trainingMode: "coach_managed",
    profile: { weight: 71 },
  });
  const admin = await account({ role: "Admin" });
  await submit(user).expect(201);
  await review(admin, user, "approved").expect(200);
  const saved = await User.findById(user.id);
  expect(saved.assignedTrainerId).toBeNull();
  expect(saved.trainingMode).toBe("independent");
  expect(saved.profile.weight).toBe(71);
  expect(saved.email).toBe(user.email);
});

test("an inactive account cannot be approved", async () => {
  const user = await account();
  const admin = await account({ role: "Admin" });
  await submit(user).expect(201);
  await User.updateOne({ _id: user.id }, { $set: { isActive: false } });
  await review(admin, user, "approved").expect(409);
  expect((await User.findById(user.id)).role).toBe("Cliente");
});
