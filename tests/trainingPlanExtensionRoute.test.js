import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { calculatePlanExtension } from "../src/utils/trainingPlanExtension.js";

const source = {
  _id: "plan-original",
  athleteId: "athlete",
  name: "Mes 1",
  status: "completed",
  startDate: new Date("2026-08-10"),
  endDate: new Date("2026-10-25"),
  updatedAt: new Date("2026-10-20T10:00:00Z"),
  durationWeeks: 11,
};

const extendTrainingPlanInPlace = jest.fn(async ({ additionalWeeks }) => ({
  ...source,
  ...calculatePlanExtension(source, additionalWeeks, new Date("2026-10-25")),
}));
const syncTrainingPlanLifecycle = jest.fn().mockResolvedValue(false);

jest.unstable_mockModule("../src/middleware/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { id: "athlete", role: "Cliente", trainingMode: "self_managed" };
    next();
  },
  ensureCanAccessOwner: jest.fn(),
}));
jest.unstable_mockModule("../src/utils/trainingPlanLifecycle.js", () => ({
  syncTrainingPlanLifecycle,
  isFuturePlan: jest.fn(),
}));
jest.unstable_mockModule("../src/services/trainingPlanExtensionService.js", () => ({
  extendTrainingPlanInPlace,
}));

const { default: plansRouter } = await import("../src/routes/plans.js");
const app = express();
app.use(express.json());
app.use("/api/plans", plansRouter);
app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message });
});

describe("contrato HTTP de extensión de planificación", () => {
  beforeEach(() => jest.clearAllMocks());

  test("acepta dos semanas adicionales sin pedir una nueva fecha de inicio", async () => {
    const response = await request(app)
      .post("/api/plans/plan-original/extend")
      .send({
        additionalWeeks: 2,
        expectedEndDate: source.endDate,
        expectedUpdatedAt: source.updatedAt,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      _id: source._id,
      name: source.name,
      startDate: source.startDate.toISOString(),
      endDate: "2026-11-08T00:00:00.000Z",
      durationWeeks: 13,
      status: "active",
    });
    expect(extendTrainingPlanInPlace).toHaveBeenCalledTimes(1);
    expect(extendTrainingPlanInPlace).toHaveBeenCalledWith({
      planId: source._id,
      athleteId: source.athleteId,
      additionalWeeks: 2,
      expectedEndDate: source.endDate.toISOString(),
      expectedUpdatedAt: source.updatedAt.toISOString(),
    });
  });

  test("mantiene el alias durationWeeks para clientes anteriores", async () => {
    const response = await request(app)
      .post("/api/plans/plan-original/extend")
      .send({ durationWeeks: 2 });
    expect(response.status).toBe(200);
    expect(response.body.durationWeeks).toBe(13);
  });

  test("prioriza las semanas adicionales sobre el alias antiguo", async () => {
    const response = await request(app)
      .post("/api/plans/plan-original/extend")
      .send({ additionalWeeks: 2, durationWeeks: 8 });
    expect(response.status).toBe(200);
    expect(response.body.endDate).toBe("2026-11-08T00:00:00.000Z");
  });

  test.each([0, 53, 1.5])("rechaza una extensión inválida de %s semanas", async (weeks) => {
    const response = await request(app)
      .post("/api/plans/plan-original/extend")
      .send({ additionalWeeks: weeks, durationWeeks: 2 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/1 a 52/);
  });
});
