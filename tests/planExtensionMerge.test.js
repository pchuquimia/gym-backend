import {
  buildPlanExtensionMerges,
  remapPlanReferences,
} from "../src/utils/planExtensionMerge.js";

const plan = (id, sourcePlanId, startDate, endDate, status = "completed") => ({
  _id: id,
  sourcePlanId,
  athleteId: "athlete",
  coachId: null,
  name: id === "first" ? "Mes 1" : "Continuación",
  startDate,
  endDate,
  status,
  scheduleMode: "fixed",
  weeklySchedule: [
    {
      slotId: "slot_1",
      dayIndex: 1,
      type: "training",
      routineId: `routine-${id}`,
    },
  ],
});
const chain = () => [
  plan("first", null, "2026-08-10", "2026-09-06"),
  plan("second", "first", "2026-09-07", "2026-10-11"),
  plan("third", "second", "2026-10-12", "2026-10-18"),
  plan("current", "third", "2026-10-19", "2026-10-25", "active"),
];

test("fusiona toda la cadena conservando el ID activo, las fechas originales y las rutinas actuales", () => {
  const [merge] = buildPlanExtensionMerges(chain());
  expect(merge.canonicalId).toBe("current");
  expect(merge.updates).toMatchObject({
    name: "Mes 1",
    durationWeeks: 11,
    sourcePlanId: null,
    mergedPlanIds: ["first", "second", "third"],
  });
  expect(merge.updates.startDate.toISOString()).toBe(
    "2026-08-10T00:00:00.000Z",
  );
  expect(merge.updates.endDate.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  expect(merge.currentRoutineIds).toEqual(["routine-current"]);
});
test("no fusiona asignaciones de coaches ni inventa coincidencias por nombre", () => {
  expect(
    buildPlanExtensionMerges(
      chain().map((item) => ({ ...item, coachId: "coach" })),
    ),
  ).toEqual([]);
  expect(
    buildPlanExtensionMerges([plan("first", null, "2026-08-10", "2026-09-06")]),
  ).toEqual([]);
});
test("rechaza ramas, ciclos, otro propietario y estructuras incompatibles", () => {
  expect(() =>
    buildPlanExtensionMerges([
      ...chain(),
      plan("branch", "first", "2026-09-07", "2026-10-11"),
    ]),
  ).toThrow(/varias continuaciones/);
  expect(() =>
    buildPlanExtensionMerges([
      plan("a", "b", "2026-08-10", "2026-09-06"),
      plan("b", "a", "2026-09-07", "2026-10-11"),
    ]),
  ).toThrow(/circulares/);
  const changed = chain();
  changed[1].athleteId = "other";
  expect(() => buildPlanExtensionMerges(changed)).toThrow(/incompatible/);
  const changedSlots = chain();
  changedSlots[1].weeklySchedule[0].slotId = "different";
  expect(() => buildPlanExtensionMerges(changedSlots)).toThrow(/estructura/);
});
test("actualiza solo referencias de plan y preserva series, fechas y objetos BSON", () => {
  const date = new Date();
  const data = {
    date,
    routineId: "first",
    trainingPlanId: "first",
    snapshot: { context: { planId: "second" } },
    exercises: [{ name: "first", sets: [{ reps: 8, done: true }] }],
  };
  expect(
    remapPlanReferences(
      data,
      new Map([
        ["first", "current"],
        ["second", "current"],
      ]),
    ),
  ).toEqual({
    ...data,
    trainingPlanId: "current",
    snapshot: { context: { planId: "current" } },
  });
});
