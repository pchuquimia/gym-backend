import {
  getDemoLifetimeHours,
  getDemoRestriction,
  isDemoRequestOriginAllowed,
  isDemoModeEnabled,
  isDemoRole,
} from "../src/utils/demoMode.js";

describe("public demo safety", () => {
  const previousMode = process.env.DEMO_MODE;
  const previousLifetime = process.env.DEMO_WORKSPACE_HOURS;
  const previousClientUrl = process.env.DEMO_CLIENT_URL;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (previousMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previousMode;
    if (previousLifetime === undefined) delete process.env.DEMO_WORKSPACE_HOURS;
    else process.env.DEMO_WORKSPACE_HOURS = previousLifetime;
    if (previousClientUrl === undefined) delete process.env.DEMO_CLIENT_URL;
    else process.env.DEMO_CLIENT_URL = previousClientUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
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

  test("en produccion limita la demo al frontend dedicado", () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_CLIENT_URL = "https://demo.apex.test";
    const requestFrom = (origin) => ({ get: () => origin });

    expect(
      isDemoRequestOriginAllowed(requestFrom("https://demo.apex.test")),
    ).toBe(true);
    expect(
      isDemoRequestOriginAllowed(requestFrom("https://app.apex.test")),
    ).toBe(false);
    expect(isDemoRequestOriginAllowed(requestFrom(""))).toBe(false);
  });
});
