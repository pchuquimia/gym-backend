import HydrationEntry from "../src/models/HydrationEntry.js";

const buildEntry = (overrides = {}) =>
  new HydrationEntry({
    ownerId: "user-1",
    dateKey: "2026-09-07",
    amountMl: 500,
    recordedBy: "user-1",
    source: "self",
    ...overrides,
  });

describe("registro de hidratación", () => {
  test("acepta una cantidad diaria válida", () => {
    expect(buildEntry().validateSync()).toBeUndefined();
  });

  test.each([49, 6001])("rechaza la cantidad fuera de rango: %s ml", (amountMl) => {
    expect(buildEntry({ amountMl }).validateSync()?.errors.amountMl).toBeTruthy();
  });

  test("exige una fecha local con formato ISO", () => {
    expect(
      buildEntry({ dateKey: "07-09-2026" }).validateSync()?.errors.dateKey,
    ).toBeTruthy();
  });
});
