import { jest } from "@jest/globals";
import Routine from "../src/models/Routine.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import { extendTrainingPlanInPlace } from "../src/services/trainingPlanExtensionService.js";
import { calculatePlanExtension } from "../src/utils/trainingPlanExtension.js";

const source = (overrides = {}) => ({
  _id: "6ad64a02eaecabf6034f4127",
  athleteId: "athlete",
  name: "Mes 1",
  startDate: new Date("2026-08-10"),
  endDate: new Date("2026-10-25"),
  durationWeeks: 11,
  status: "active",
  updatedAt: new Date("2026-10-20T10:00:00Z"),
  weeklySchedule: [
    { slotId: "slot_1", dayIndex: 1, type: "training", routineId: "routine-1" },
  ],
  cycleProgress: { currentIndex: 1, completedCycles: 5 },
  ...overrides,
});

describe("cálculo de extensión", () => {
  test("añade semanas al final sin reiniciar el plan", () => {
    const plan = source();
    expect(calculatePlanExtension(plan, 4, new Date("2026-10-20"))).toEqual({
      endDate: new Date("2026-11-22"),
      durationWeeks: 15,
      status: "active",
    });
    expect(plan.startDate).toEqual(new Date("2026-08-10"));
  });
  test("reanuda un plan vencido desde hoy, manteniendo su inicio y un final exacto", () => {
    expect(
      calculatePlanExtension(
        source({ status: "completed", endDate: new Date("2026-10-11") }),
        1,
        new Date("2026-10-20"),
      ),
    ).toEqual({
      endDate: new Date("2026-10-26"),
      durationWeeks: 12,
      status: "active",
    });
  });
  test.each(["paused", "scheduled"])("mantiene el estado %s", (status) => {
    expect(
      calculatePlanExtension(source({ status }), 1, new Date("2026-10-20"))
        .status,
    ).toBe(status);
  });
  test.each([0, -1, 1.5, 53, NaN])("rechaza semanas inválidas: %s", (weeks) => {
    expect(() => calculatePlanExtension(source(), weeks)).toThrow(/1 a 52/);
  });
  test("permite que la duración acumulada supere un año", () => {
    expect(
      calculatePlanExtension(source(), 52, new Date("2026-10-20"))
        .durationWeeks,
    ).toBe(63);
  });
  test.each(["draft", "cancelled"])("no extiende un plan %s", (status) => {
    expect(() => calculatePlanExtension(source({ status }), 1)).toThrow(
      /no se puede/,
    );
  });
});

describe("persistencia en la misma planificación", () => {
  let plan;
  let session;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-20T16:00:00Z"));
    plan = { ...source(), save: jest.fn().mockResolvedValue(undefined) };
    session = {
      withTransaction: jest.fn(async (operation) => operation()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(TrainingPlan, "startSession").mockResolvedValue(session);
    jest
      .spyOn(TrainingPlan, "findOne")
      .mockImplementation((filter) =>
        filter.$or
          ? { lean: async () => source() }
          : { session: async () => plan },
      );
    jest
      .spyOn(TrainingPlan, "exists")
      .mockReturnValue({ session: async () => null });
    jest.spyOn(TrainingPlan, "create");
    jest
      .spyOn(Routine, "countDocuments")
      .mockReturnValue({ session: async () => 1 });
    jest.spyOn(Routine, "updateMany").mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Routine, "insertMany");
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const request = () => ({
    planId: source()._id,
    athleteId: "athlete",
    additionalWeeks: 4,
    expectedEndDate: source().endDate,
    expectedUpdatedAt: source().updatedAt,
  });
  test("conserva ID, nombre, rutinas y posición del ciclo, sin crear documentos", async () => {
    const saved = await extendTrainingPlanInPlace(request());
    expect(saved).toMatchObject({
      _id: source()._id,
      name: "Mes 1",
      startDate: source().startDate,
      endDate: new Date("2026-11-22"),
      durationWeeks: 15,
      weeklySchedule: source().weeklySchedule,
      cycleProgress: source().cycleProgress,
    });
    expect(plan.save).toHaveBeenCalledWith({ session });
    expect(TrainingPlan.create).not.toHaveBeenCalled();
    expect(Routine.insertMany).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });
  test("rechaza un reintento con una fecha de fin ya modificada", async () => {
    await expect(
      extendTrainingPlanInPlace({
        ...request(),
        expectedEndDate: "2026-10-18",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(plan.save).not.toHaveBeenCalled();
  });
  test("rechaza cambios concurrentes dentro de la transacción", async () => {
    plan.updatedAt = new Date("2026-10-20T11:00:00Z");
    await expect(extendTrainingPlanInPlace(request())).rejects.toMatchObject({
      status: 409,
    });
    expect(plan.save).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });
  test("no reactiva un plan finalizado si hay otro activo", async () => {
    plan.status = "completed";
    TrainingPlan.exists.mockReturnValue({
      session: async () => ({ _id: "other" }),
    });
    await expect(extendTrainingPlanInPlace(request())).rejects.toMatchObject({
      status: 409,
    });
    expect(plan.save).not.toHaveBeenCalled();
  });
  test("no extiende un plan con rutinas ausentes", async () => {
    Routine.countDocuments.mockReturnValue({ session: async () => 0 });
    await expect(extendTrainingPlanInPlace(request())).rejects.toMatchObject({
      status: 409,
    });
    expect(plan.save).not.toHaveBeenCalled();
  });
});

describe("fechas del modelo de planificación", () => {
  const document = (overrides = {}) =>
    new TrainingPlan({
      ...source(),
      scheduleMode: "sequential_cycle",
      ...overrides,
    });
  test("preserva el final exacto de una extensión con semanas incompletas", async () => {
    const plan = document({
      endDate: new Date("2026-10-26"),
      durationWeeks: 12,
    });
    await plan.validate();
    expect(plan.endDate).toEqual(new Date("2026-10-26"));
  });
  test("un cambio de estado no mueve la fecha de fin", async () => {
    const plan = TrainingPlan.hydrate({
      ...source(),
      endDate: new Date("2026-10-26"),
      durationWeeks: 12,
    });
    plan.status = "paused";
    await plan.validate();
    expect(plan.endDate).toEqual(new Date("2026-10-26"));
  });
  test("recalcula las fechas al editar la duración de forma habitual", async () => {
    const plan = TrainingPlan.hydrate(source());
    plan.durationWeeks = 15;
    await plan.validate();
    expect(plan.endDate).toEqual(new Date("2026-11-22"));
  });
  test("calcula el final al crear una planificación y admite duración acumulada mayor a 52", async () => {
    const plan = document({ endDate: undefined, durationWeeks: 63 });
    await plan.validate();
    expect(plan.endDate).toEqual(new Date("2027-10-24"));
  });
});
