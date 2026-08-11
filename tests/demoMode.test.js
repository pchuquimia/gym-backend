import {
  getDemoLifetimeHours,
  getDemoRestriction,
  isDemoModeEnabled,
  isDemoRole,
} from "../src/utils/demoMode.js";

describe("public demo safety", () => {
  const previousMode = process.env.DEMO_MODE;
  const previousLifetime = process.env.DEMO_WORKSPACE_HOURS;

  afterEach(() => {
    if (previousMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previousMode;
    if (previousLifetime === undefined) delete process.env.DEMO_WORKSPACE_HOURS;
    else process.env.DEMO_WORKSPACE_HOURS = previousLifetime;
  });

  test("solo habilita roles publicos conocidos", () => {
    expect(isDemoRole("athlete")).toBe(true);
    expect(isDemoRole("coach")).toBe(true);
    expect(isDemoRole("admin")).toBe(true);
    expect(isDemoRole("Admin")).toBe(false);
  });

  test("interpreta el interruptor y limita la duracion", () => {
    process.env.DEMO_MODE = "true";
    process.env.DEMO_WORKSPACE_HOURS = "24";
    expect(isDemoModeEnabled()).toBe(true);
    expect(getDemoLifetimeHours()).toBe(24);

    process.env.DEMO_WORKSPACE_HOURS = "999";
    expect(getDemoLifetimeHours()).toBe(12);
  });

  test("protege cuentas, catalogo y medios sin bloquear entrenamientos", () => {
    expect(
      getDemoRestriction({
        method: "DELETE",
        baseUrl: "/api/users",
        path: "/abc",
      }),
    ).toMatch(/cuentas/i);
    expect(
      getDemoRestriction({
        method: "POST",
        baseUrl: "/api/photos",
        path: "/upload",
      }),
    ).toMatch(/imagenes/i);
    expect(
      getDemoRestriction({
        method: "POST",
        baseUrl: "/api/trainings",
        path: "/",
      }),
    ).toBe("");
    expect(
      getDemoRestriction({
        method: "GET",
        baseUrl: "/api/users",
        path: "/",
      }),
    ).toBe("");
  });
});
