import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import request from "supertest";
import { jest } from "@jest/globals";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Photo from "../src/models/Photo.js";
import Exercise from "../src/models/Exercise.js";
import { resetAuthenticationUserCache } from "../src/services/authenticationUserCache.js";
import {
  privatePhotoUploadsDir,
  publicUploadsDir,
} from "../src/utils/photoStorage.js";

describe("rejected uploads", () => {
  const ownerId = "507f1f77bcf86cd799439011";
  let token;
  let previousSecret;
  beforeAll(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
    token = jwt.sign(
      { id: ownerId, sid: "upload-test" },
      process.env.JWT_SECRET,
    );
  });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  beforeEach(() => {
    resetAuthenticationUserCache();
    jest.spyOn(User, "findById").mockReturnValue({
      lean: () => ({
        exec: async () => ({
          _id: ownerId,
          role: "Cliente",
          isActive: true,
          activeSessions: [{ sessionId: "upload-test" }],
        }),
      }),
    });
  });

  test.each([404, 403])(
    "photo replacement with status %s leaves no private file",
    async (status) => {
      jest
        .spyOn(Photo, "findById")
        .mockReturnValue({
          lean: async () =>
            status === 404 ? null : { ownerId: "another-user" },
        });
      const before = await fs.readdir(privatePhotoUploadsDir);
      await request(app)
        .post("/api/photos/507f1f77bcf86cd799439099/replace")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("not-an-image"), {
          filename: "audit.png",
          contentType: "image/png",
        })
        .expect(status);
      // Response completion may precede async finally cleanup by one microtask.
      await new Promise((resolve) => setImmediate(resolve));
      expect(await fs.readdir(privatePhotoUploadsDir)).toEqual(before);
    },
  );

  test.each([404, 403, 500])(
    "exercise upload with status %s leaves no public file",
    async (status) => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(Exercise, "findById").mockImplementation(async () => {
        if (status === 500) throw new Error("simulated database failure");
        return status === 404
          ? null
          : { type: "custom", ownerId: "another-user" };
      });
      const before = new Set(await fs.readdir(publicUploadsDir));
      try {
        await request(app)
          .post("/api/exercises/missing-audit-exercise/media")
          .set("Authorization", `Bearer ${token}`)
          .attach("file", Buffer.from("not-an-image"), {
            filename: "audit.png",
            contentType: "image/png",
          })
          .expect(status);
        await new Promise((resolve) => setImmediate(resolve));
        expect(
          (await fs.readdir(publicUploadsDir)).filter(
            (filename) => !before.has(filename),
          ),
        ).toEqual([]);
      } finally {
        log.mockRestore();
        for (const filename of await fs.readdir(publicUploadsDir)) {
          if (!before.has(filename))
            await fs.unlink(path.join(publicUploadsDir, filename));
        }
      }
    },
  );
});
