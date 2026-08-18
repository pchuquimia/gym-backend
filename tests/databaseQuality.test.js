import mongoose from "mongoose";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import { getMongoConnectionOptions } from "../src/config/db.js";

describe("Database quality guards", () => {
  test("declara unicidad para nuevos registros de entrenamiento", () => {
    const duplicateIndex = Training.schema
      .indexes()
      .find(([, options]) => options.name === "unique_training_registration");

    expect(duplicateIndex).toBeDefined();
    expect(duplicateIndex[0]).toEqual({ registrationKey: 1 });
    expect(duplicateIndex[1].unique).toBe(true);
    expect(duplicateIndex[1].sparse).toBe(true);
  });

  test("rechaza fechas, propietarios y metricas invalidas", () => {
    const trainingError = new Training({
      date: "18-08-2026",
      durationSeconds: -1,
      totalVolume: -10,
    }).validateSync();

    expect(trainingError.errors).toHaveProperty("date");
    expect(trainingError.errors).toHaveProperty("ownerId");
    expect(trainingError.errors).toHaveProperty("durationSeconds");
    expect(trainingError.errors).toHaveProperty("totalVolume");
  });

  test("limita valores negativos en sesiones", () => {
    const error = new Session({
      date: "2026-08-18",
      ownerId: new mongoose.Types.ObjectId().toString(),
      exerciseId: "bench-press",
      exerciseName: "Bench press",
      sets: [{ reps: -1, weight: -5 }],
    }).validateSync();

    expect(Object.keys(error.errors)).toEqual(
      expect.arrayContaining(["sets.0.reps", "sets.0.weight"]),
    );
  });

  test("rechaza bloques duplicados y declara unicidad del plan activo", () => {
    const plan = new TrainingPlan({
      name: "Plan",
      athleteId: new mongoose.Types.ObjectId().toString(),
      createdById: new mongoose.Types.ObjectId().toString(),
      startDate: new Date("2026-08-18T00:00:00.000Z"),
      endDate: new Date("2026-09-18T00:00:00.000Z"),
      frequencyTarget: 2,
      weeklySchedule: [
        { slotId: "slot_1", dayIndex: 1, order: 1 },
        { slotId: "slot_1", dayIndex: 1, order: 2 },
      ],
    });
    const error = plan.validateSync();
    expect(error.errors).toHaveProperty("weeklySchedule");

    const activeIndex = TrainingPlan.schema
      .indexes()
      .find(([, options]) => options.name === "one_active_plan_per_athlete");
    expect(activeIndex).toBeDefined();
    expect(activeIndex[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { status: "active" },
    });
  });

  test("activa validadores de updates y limita espera por conexiones", () => {
    expect(mongoose.get("runValidators")).toBe(true);
    expect(getMongoConnectionOptions()).toMatchObject({
      waitQueueTimeoutMS: 5_000,
      appName: "apex-performance-api",
    });
  });
});
