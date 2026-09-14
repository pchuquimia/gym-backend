import express from "express";
import request from "supertest";
import {
  getPerformanceSnapshot,
  measureDatabase,
  performanceTiming,
  resetPerformanceMetrics,
} from "../src/middleware/performanceTiming.js";

describe("performance timing", () => {
  beforeEach(() => resetPerformanceMetrics());

  test("agrega percentiles, tamano, cache y operaciones por ruta", async () => {
    const app = express();
    app.use(performanceTiming);
    app.get("/probe/:id", async (_req, res) => {
      await measureDatabase(res, () => Promise.resolve(), { operations: 3 });
      res.set("X-Data-Cache", "PROBE-HIT");
      res.json({ ok: true });
    });

    const first = await request(app).get("/probe/507f1f77bcf86cd799439011");
    await request(app).get("/probe/507f1f77bcf86cd799439012");

    expect(first.headers["server-timing"]).toMatch(/desc="3 ops"/);
    const snapshot = getPerformanceSnapshot();
    const route = snapshot.routes.find(
      (metric) => metric.route === "GET /probe/:id",
    );
    expect(route).toMatchObject({
      totalRequests: 2,
      sampledRequests: 2,
      errors: 0,
      cacheHitRate: 100,
      databaseOperations: { average: 3, max: 3 },
      statuses: { 200: 2 },
    });
    expect(route.durationMs.p95).toBeGreaterThanOrEqual(0);
    expect(route.responseBytes.p50).toBeGreaterThan(0);
  });
});
