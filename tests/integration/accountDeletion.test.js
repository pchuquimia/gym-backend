import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";
import { resetAuthenticationUserCache } from "../../src/services/authenticationUserCache.js";
import User from "../../src/models/User.js";
import TrainingDraft from "../../src/models/TrainingDraft.js";
import HydrationEntry from "../../src/models/HydrationEntry.js";
import UserNotification from "../../src/models/UserNotification.js";
import { deleteAccountData } from "../../src/services/accountDeletionService.js";

let replSet;
beforeAll(async () => {
  // The URI is generated here: never load .env or use MONGO_URI for these tests.
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, ip: "127.0.0.1" },
  });
  await mongoose.connect(replSet.getUri("rirfit_account_deletion_test"));
  await Promise.all(
    Object.values(mongoose.models).map((Model) => Model.init()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
beforeEach(async () => {
  for (const Model of Object.values(mongoose.models))
    await Model.deleteMany({});
});

const user = (extra = {}) =>
  User.create({
    name: "Audit User",
    email: `${crypto.randomUUID()}@example.invalid`,
    password: crypto.randomBytes(32).toString("hex"),
    ...extra,
  });
const draft = (ownerId, startedById) =>
  TrainingDraft.create({
    ownerId: String(ownerId),
    startedById: String(startedById),
    trainingRequestId: crypto.randomUUID(),
    routineId: "test-routine",
    snapshot: { exercises: [{ name: "Private training snapshot" }] },
  });

test("deletion removes drafts owned or authored by the account and keeps unrelated data", async () => {
  const owner = await user();
  const other = await user();
  await draft(owner.id, other.id);
  await draft(other.id, owner.id);
  const unrelated = await draft(other.id, other.id);
  await HydrationEntry.create({
    ownerId: owner.id,
    dateKey: "2026-10-20",
    amountMl: 500,
    recordedBy: owner.id,
    source: "self",
  });
  await UserNotification.create({
    userId: owner.id,
    type: "plan_activated",
    title: "Plan",
    message: "Private message",
  });

  const result = await deleteAccountData(owner.id);

  expect(result.deleted.trainingDrafts).toBe(2);
  expect(await User.findById(owner.id)).toBeNull();
  expect(await User.findById(other.id)).not.toBeNull();
  expect(
    (await TrainingDraft.find({}).lean()).map((entry) => String(entry._id)),
  ).toEqual([unrelated.id]);
  expect(await HydrationEntry.countDocuments({ ownerId: owner.id })).toBe(0);
  expect(await UserNotification.countDocuments({ userId: owner.id })).toBe(0);
});

test("a failure at the end rolls back the account and all previous deletions", async () => {
  const owner = await user();
  const savedDraft = await draft(owner.id, owner.id);
  const notification = await UserNotification.create({
    userId: owner.id,
    type: "plan_activated",
    title: "Plan",
    message: "Private message",
  });
  jest
    .spyOn(User, "deleteOne")
    .mockRejectedValueOnce(new Error("simulated final deletion failure"));

  await expect(deleteAccountData(owner.id)).rejects.toThrow(
    "simulated final deletion failure",
  );

  expect(await User.findById(owner.id)).not.toBeNull();
  expect(await TrainingDraft.findById(savedDraft.id)).not.toBeNull();
  expect(await UserNotification.findById(notification.id)).not.toBeNull();
});

test("deleting a coach clears the relationship and their drafts while preserving the athlete", async () => {
  const coach = await user({ role: "Entrenador" });
  const athlete = await user({
    assignedTrainerId: coach.id,
    trainingMode: "coach_managed",
  });
  await draft(athlete.id, coach.id);

  await deleteAccountData(coach.id);

  const remaining = await User.findById(athlete.id).lean();
  expect(remaining.assignedTrainerId).toBeNull();
  expect(remaining.trainingMode).toBe("independent");
  expect(await TrainingDraft.countDocuments({ startedById: coach.id })).toBe(0);
});

test("draft TTL and actor uniqueness indexes are installed in the test database", async () => {
  const indexes = await TrainingDraft.collection.indexes();
  expect(indexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      expect.objectContaining({
        key: { ownerId: 1, startedById: 1 },
        unique: true,
      }),
    ]),
  );
});

test("cookie writes require the issued CSRF token and persist only trusted requests", async () => {
  const keys = ["JWT_SECRET", "CLIENT_URL", "NODE_ENV"];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.CLIENT_URL = "https://app.example.invalid";
  process.env.NODE_ENV = "production";
  resetAuthenticationUserCache();
  try {
    const account = await user({
      activeSessions: [{ sessionId: "integration-session" }],
    });
    const token = jwt.sign(
      { id: account.id, sid: "integration-session" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
    const cookie = `jwt=${token}`;
    const payload = { dateKey: "2026-10-20", amountMl: 500 };
    const csrf = await request(app)
      .get("/api/auth/csrf")
      .set("Cookie", cookie)
      .expect(200);

    await request(app)
      .post("/api/hydration")
      .set("Cookie", cookie)
      .send(payload)
      .expect(403);
    await request(app)
      .post("/api/hydration")
      .set("Cookie", cookie)
      .set("Origin", "https://untrusted.example")
      .set("X-CSRF-Token", csrf.body.csrfToken)
      .type("form")
      .send(payload)
      .expect(403);
    expect(await HydrationEntry.countDocuments({ ownerId: account.id })).toBe(
      0,
    );

    await request(app)
      .post("/api/hydration")
      .set("Cookie", cookie)
      .set("Origin", process.env.CLIENT_URL)
      .set("X-CSRF-Token", csrf.body.csrfToken)
      .send(payload)
      .expect(201);
    expect(await HydrationEntry.countDocuments({ ownerId: account.id })).toBe(
      1,
    );
  } finally {
    resetAuthenticationUserCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
