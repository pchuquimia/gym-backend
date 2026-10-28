import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { jest } from "@jest/globals";
import {
  csrfProtection,
  issueCsrfToken,
} from "../src/middleware/csrfProtection.js";
import app from "../src/app.js";

describe("session-bound CSRF protection", () => {
  let server;
  let mutate;
  const previous = {};

  beforeAll(() => {
    for (const key of ["JWT_SECRET", "CLIENT_URL", "NODE_ENV"])
      previous[key] = process.env[key];
    process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
    process.env.CLIENT_URL = "https://app.example.invalid";
    process.env.NODE_ENV = "production";
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(() => {
    mutate = jest.fn((_req, res) => res.sendStatus(201));
    server = express();
    server.use(cookieParser(), csrfProtection);
    server.get("/csrf", issueCsrfToken);
    server.post("/mutate", mutate);
  });

  const tokenFor = async (cookie = "jwt=session-a") => {
    const response = await request(server)
      .get("/csrf")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.body.csrfToken;
  };

  test.each([
    "https://untrusted.example",
    "null",
    "https://app.example.invalid.evil.test",
  ])("rejects form writes from %s before the handler", async (origin) => {
    const response = await request(server)
      .post("/mutate")
      .set("Origin", origin)
      .set("Cookie", "jwt=session-a")
      .type("form")
      .send({ amountMl: 500 })
      .expect(403);
    expect(response.body.code).toBe("UNTRUSTED_ORIGIN");
    expect(mutate).not.toHaveBeenCalled();
  });
  test("rejects cookie writes without a CSRF token, even with a trusted or absent origin", async () => {
    for (const headers of [{ Origin: process.env.CLIENT_URL }, {}]) {
      await request(server)
        .post("/mutate")
        .set(headers)
        .set("Cookie", "jwt=session-a")
        .expect(403);
    }
    expect(mutate).not.toHaveBeenCalled();
  });
  test("accepts a token bound to the current session", async () => {
    await request(server)
      .post("/mutate")
      .set("Origin", process.env.CLIENT_URL)
      .set("Cookie", "jwt=session-a")
      .set("X-CSRF-Token", await tokenFor())
      .expect(201);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  test("rejects a forged token or one issued for a different session", async () => {
    for (const csrf of [
      await tokenFor("jwt=other-session"),
      `${"a".repeat(64)}.${"b".repeat(64)}`,
    ]) {
      await request(server)
        .post("/mutate")
        .set("Cookie", "jwt=session-a")
        .set("X-CSRF-Token", csrf)
        .expect(403);
    }
    expect(mutate).not.toHaveBeenCalled();
  });
  test("rejects multipart writes before file processing", async () => {
    await request(server)
      .post("/mutate")
      .set("Cookie", "jwt=session-a")
      .attach("file", Buffer.from("audit"), "audit.png")
      .expect(403);
    expect(mutate).not.toHaveBeenCalled();
  });
  test("keeps bearer-only clients working without ambient cookies", async () => {
    await request(server)
      .post("/mutate")
      .set("Authorization", "Bearer api-client")
      .expect(201);
  });
  test("blocks the original hydration reproduction in the full application", async () => {
    await request(app)
      .post("/api/hydration")
      .set("Origin", "https://untrusted.example")
      .set("Cookie", "jwt=session-a")
      .type("form")
      .send({ dateKey: "2026-10-20", amountMl: 500 })
      .expect(403);
  });
  test("allows the CSRF header in trusted CORS preflight requests", async () => {
    const response = await request(app)
      .options("/api/hydration")
      .set("Origin", process.env.CLIENT_URL)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "X-CSRF-Token")
      .expect(200);
    expect(response.headers["access-control-allow-headers"]).toContain(
      "X-CSRF-Token",
    );
  });
});
