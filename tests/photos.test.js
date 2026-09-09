import path from "path";
import { jest } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";
import Photo from "../src/models/Photo.js";
import { describePhotoAsset } from "../src/services/photoAssetCleanupService.js";
import {
  normalizePhotoDate,
  resolveUploadedPhotoVisibility,
} from "../src/routes/photos.js";
import {
  filenameFromStoredUrl,
  privatePhotoUploadsDir,
  safeStoredFilePath,
} from "../src/utils/photoStorage.js";

describe("progress photo safeguards", () => {
  test("accepts real calendar dates and rejects impossible or future dates", () => {
    expect(normalizePhotoDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizePhotoDate("2024-02-30")).toBe("");
    expect(normalizePhotoDate("not-a-date")).toBe("");
    expect(normalizePhotoDate("2999-01-01")).toBe("");
  });

  test("never resolves a stored filename outside its storage directory", () => {
    expect(safeStoredFilePath(privatePhotoUploadsDir, "photo.webp")).toBe(
      path.resolve(privatePhotoUploadsDir, "photo.webp"),
    );
    expect(safeStoredFilePath(privatePhotoUploadsDir, "../secret.txt")).toBe(
      "",
    );
    expect(safeStoredFilePath(privatePhotoUploadsDir, "")).toBe("");
  });

  test("extracts only the final filename from legacy upload URLs", () => {
    expect(
      filenameFromStoredUrl("https://example.com/uploads/progress-1.webp"),
    ).toBe("progress-1.webp");
    expect(filenameFromStoredUrl("not-a-url")).toBe("");
  });

  test("shares profile photos with the assigned coach by default", () => {
    expect(
      resolveUploadedPhotoVisibility({
        type: "profile",
        requestedVisibility: "private",
      }),
    ).toBe("coach");
  });

  test("keeps non-profile photos private when visibility is omitted", () => {
    expect(resolveUploadedPhotoVisibility({ type: "gym" })).toBe("private");
  });

  test("queues known managed assets but leaves external URLs untouched", () => {
    expect(
      describePhotoAsset({
        publicId: "progress/photo-1",
        deliveryType: "authenticated",
      }),
    ).toEqual({
      publicId: "progress/photo-1",
      deliveryType: "authenticated",
      storage: "cloudinary",
    });
    expect(
      describePhotoAsset({
        storage: "private-local",
        localFilename: "progress-2.webp",
      }),
    ).toEqual({
      storage: "private-local",
      localFilename: "progress-2.webp",
    });
    expect(
      describePhotoAsset({ url: "https://images.example.com/photo.webp" }),
    ).toBeNull();
  });

  test("does not expose progress-photo files through the public uploads route", async () => {
    jest.spyOn(Photo, "exists").mockResolvedValue({ _id: "photo-id" });

    await request(app).get("/uploads/private-progress.webp").expect(404);

    expect(Photo.exists).toHaveBeenCalledWith({
      $or: [
        { localFilename: "private-progress.webp" },
        { url: { $regex: "/uploads/private-progress\\.webp(?:\\?|$)" } },
      ],
    });
  });
});
