import { jest } from "@jest/globals";
import { createSingleFlight } from "../src/utils/singleFlight.js";

describe("createSingleFlight", () => {
  test("comparte una operacion en curso entre solicitudes con la misma clave", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const operation = jest.fn(async () => {
      await gate;
      return { ok: true };
    });
    const singleFlight = createSingleFlight();

    const first = singleFlight.run("dashboard:core", operation);
    const second = singleFlight.run("dashboard:core", operation);
    release();

    await expect(first).resolves.toEqual({
      value: { ok: true },
      shared: false,
    });
    await expect(second).resolves.toEqual({
      value: { ok: true },
      shared: true,
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(singleFlight.size()).toBe(0);
  });

  test("elimina operaciones fallidas y permite reintentarlas", async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporal"))
      .mockResolvedValueOnce("recuperado");
    const singleFlight = createSingleFlight();

    await expect(singleFlight.run("dashboard:core", operation)).rejects.toThrow(
      "temporal",
    );
    await expect(singleFlight.run("dashboard:core", operation)).resolves.toEqual(
      { value: "recuperado", shared: false },
    );
    expect(operation).toHaveBeenCalledTimes(2);
    expect(singleFlight.size()).toBe(0);
  });
});
