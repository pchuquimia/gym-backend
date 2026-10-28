import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";
import User from "../../src/models/User.js";
import CoachMessage from "../../src/models/CoachMessage.js";
import { resetAuthenticationUserCache } from "../../src/services/authenticationUserCache.js";
import { deleteDemoWorkspace } from "../../src/services/demoWorkspaceService.js";
import { deleteAccountData } from "../../src/services/accountDeletionService.js";

let database;
let coach;
let athlete;
let outsider;
const previousSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1, ip: "127.0.0.1" },
  });
  await mongoose.connect(database.getUri("rirfit_coach_messages_test"));
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
const account = (extra = {}) =>
  User.create({
    name: "Beta User",
    email: `${crypto.randomUUID()}@example.invalid`,
    password: crypto.randomBytes(32).toString("hex"),
    activeSessions: [{ sessionId: "messages-test" }],
    ...extra,
  });
const token = (user) =>
  `Bearer ${jwt.sign({ id: user.id, sid: "messages-test" }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;
const send = (
  sender,
  peer,
  text = "Revisemos tu próxima sesión",
  clientMessageId = crypto.randomUUID(),
) =>
  request(app)
    .post(`/api/messages/${peer.id}`)
    .set("Authorization", token(sender))
    .send({ text, clientMessageId });
const thread = (user, peer, query = "") =>
  request(app)
    .get(`/api/messages/${peer.id}${query}`)
    .set("Authorization", token(user));
const inbox = (user) =>
  request(app).get("/api/messages").set("Authorization", token(user));
beforeEach(async () => {
  resetAuthenticationUserCache();
  for (const Model of Object.values(mongoose.models))
    await Model.deleteMany({});
  coach = await account({ role: "Entrenador" });
  athlete = await account({
    assignedTrainerId: coach.id,
    trainingMode: "coach_managed",
  });
  outsider = await account({ role: "Entrenador" });
});

test("coach and athlete exchange persisted messages and see only their own inbox", async () => {
  expect((await inbox(coach).expect(200)).body.conversations[0].peer.id).toBe(
    athlete.id,
  );
  const sent = await send(coach, athlete).expect(201);
  await send(athlete, coach, "Gracias, entrenaré mañana").expect(201);
  const result = await thread(athlete, coach).expect(200);
  expect(result.body.messages.map((message) => message.text)).toEqual([
    "Revisemos tu próxima sesión",
    "Gracias, entrenaré mañana",
  ]);
  expect((await inbox(athlete).expect(200)).body.conversations[0].unread).toBe(
    1,
  );
  expect((await inbox(outsider).expect(200)).body.conversations).toEqual([]);
  const read = await request(app)
    .patch(`/api/messages/${coach.id}/read`)
    .set("Authorization", token(athlete))
    .send({ messageIds: [sent.body.message._id] })
    .expect(200);
  expect(read.body.updated).toBe(1);
  expect((await inbox(athlete).expect(200)).body.conversations[0].unread).toBe(
    0,
  );
  expect(
    (await thread(coach, athlete).expect(200)).body.messages[0].readAt,
  ).toBeTruthy();
});

test("other coaches, unrelated clients and admins cannot read, send or mark a conversation", async () => {
  await send(coach, athlete).expect(201);
  const admin = await account({ role: "Admin" });
  for (const stranger of [outsider, admin]) {
    await thread(stranger, athlete).expect(403);
    await send(stranger, athlete).expect(403);
    await request(app)
      .patch(`/api/messages/${athlete.id}/read`)
      .set("Authorization", token(stranger))
      .send({ messageIds: [new mongoose.Types.ObjectId().toString()] })
      .expect(403);
  }
  const otherAthlete = await account({ assignedTrainerId: outsider.id });
  await thread(athlete, otherAthlete).expect(403);
  await send(athlete, outsider).expect(403);
  await request(app).get(`/api/messages/${athlete.id}`).expect(401);
});

test("retries and simultaneous sends do not duplicate a message", async () => {
  const id = crypto.randomUUID();
  const results = await Promise.all([
    send(coach, athlete, "Mensaje único", id),
    send(coach, athlete, "Mensaje único", id),
  ]);
  expect(results.map((result) => result.status)).toEqual([201, 201]);
  expect(results[0].body.message._id).toBe(results[1].body.message._id);
  expect(await CoachMessage.countDocuments({})).toBe(1);
  await send(coach, athlete, "Otro contenido", id).expect(409);
});

test("detaching an athlete revokes cached-session access in both directions", async () => {
  await send(coach, athlete).expect(201);
  await inbox(athlete).expect(200);
  await User.updateOne(
    { _id: athlete.id },
    { $set: { assignedTrainerId: null, trainingMode: "independent" } },
  );
  await thread(coach, athlete).expect(403);
  await thread(athlete, coach).expect(403);
  await send(athlete, coach).expect(403);
  expect((await inbox(athlete).expect(200)).body.conversations).toEqual([]);
});

test("inactive peers and demoted coaches cannot access conversations", async () => {
  await send(coach, athlete).expect(201);
  await User.updateOne({ _id: coach.id }, { $set: { role: "Cliente" } });
  await thread(coach, athlete).expect(403);
  await thread(athlete, coach).expect(403);
  await User.updateOne({ _id: athlete.id }, { $set: { isActive: false } });
  expect((await inbox(outsider).expect(200)).body.conversations).toEqual([]);
});

test("history paginates without gaps or repeats and validates input", async () => {
  const docs = Array.from({ length: 61 }, (_, index) => ({
    coachId: coach.id,
    athleteId: athlete.id,
    senderId: coach.id,
    recipientId: athlete.id,
    text: `Mensaje ${index}`,
    clientMessageId: crypto.randomUUID(),
  }));
  await CoachMessage.insertMany(docs);
  const first = (await thread(athlete, coach).expect(200)).body;
  expect(first.messages).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  const older = (
    await thread(athlete, coach, `?before=${first.nextCursor}`).expect(200)
  ).body;
  expect(older.messages).toHaveLength(11);
  expect(older.hasMore).toBe(false);
  expect(
    new Set(
      [...older.messages, ...first.messages].map((message) => message._id),
    ).size,
  ).toBe(61);
  await send(coach, athlete, "  ").expect(400);
  await send(coach, athlete, "x".repeat(2001)).expect(400);
  await thread(coach, athlete, "?before=invalid").expect(400);
});

test("read receipts only change received messages explicitly loaded by the reader", async () => {
  const incoming = (await send(coach, athlete).expect(201)).body.message;
  const outgoing = (await send(athlete, coach).expect(201)).body.message;
  await request(app)
    .patch(`/api/messages/${coach.id}/read`)
    .set("Authorization", token(athlete))
    .send({ messageIds: [outgoing._id] })
    .expect(200);
  expect((await CoachMessage.findById(outgoing._id)).readAt).toBeNull();
  expect((await CoachMessage.findById(incoming._id)).readAt).toBeNull();
});

test("account deletion removes exchanged messages and keeps unrelated conversations", async () => {
  await send(coach, athlete).expect(201);
  await send(athlete, coach).expect(201);
  const otherAthlete = await account({ assignedTrainerId: outsider.id });
  const otherMessage = (await send(outsider, otherAthlete).expect(201)).body
    .message;
  const result = await deleteAccountData(athlete.id);
  expect(result.deleted.messages).toBe(2);
  expect(
    (await CoachMessage.find({}).lean()).map((message) => String(message._id)),
  ).toEqual([otherMessage._id]);
});

test("demo workspaces isolate conversations and cleanup deletes their messages", async () => {
  const demoCoach = await account({
    role: "Entrenador",
    isDemo: true,
    demoWorkspaceId: "messages-demo",
  });
  const demoAthlete = await account({
    assignedTrainerId: demoCoach.id,
    isDemo: true,
    demoWorkspaceId: "messages-demo",
  });
  const otherDemo = await account({
    assignedTrainerId: demoCoach.id,
    isDemo: true,
    demoWorkspaceId: "other-demo",
  });
  await send(demoCoach, demoAthlete).expect(201);
  await send(demoCoach, otherDemo).expect(403);
  await send(coach, demoAthlete).expect(403);
  await deleteDemoWorkspace("messages-demo");
  expect(await CoachMessage.countDocuments({ coachId: demoCoach.id })).toBe(0);
  expect(await User.findById(otherDemo.id)).not.toBeNull();
});
