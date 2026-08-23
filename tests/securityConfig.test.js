import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSecureAdminPassword,
  assertSecureJwtSecret,
  canExposeArchitectureDetails,
  estimateShannonEntropyBits,
  isDevelopmentAdminRouteEnabled,
  requiresSessionBoundToken,
} from "../src/config/security.js";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("security configuration", () => {
  test("acepta secretos JWT aleatorios con longitud y entropia suficientes", () => {
    const secret = crypto.randomBytes(48).toString("base64url");
    expect(estimateShannonEntropyBits(secret)).toBeGreaterThan(120);
    expect(() => assertSecureJwtSecret(secret)).not.toThrow();
  });

  test("rechaza JWT_SECRET debil sin incluir su valor en el error", () => {
    const weakSecret = "short-placeholder";
    expect(() => assertSecureJwtSecret(weakSecret)).toThrow(/JWT_SECRET/);
    try {
      assertSecureJwtSecret(weakSecret);
    } catch (error) {
      expect(error.message).not.toContain(weakSecret);
    }
  });

  test("valida una credencial administrativa fuerte", () => {
    const password = crypto.randomBytes(32).toString("base64url");
    expect(() => assertSecureAdminPassword(password)).not.toThrow();
  });

  test("la ruta dev requiere opt-in y nunca se habilita en produccion", () => {
    expect(
      isDevelopmentAdminRouteEnabled({
        NODE_ENV: "production",
        DEV_ADMIN_LOGIN: "true",
      }),
    ).toBe(false);
    expect(
      isDevelopmentAdminRouteEnabled({
        NODE_ENV: "development",
        DEV_ADMIN_LOGIN: "false",
      }),
    ).toBe(false);
    expect(
      isDevelopmentAdminRouteEnabled({
        NODE_ENV: "development",
        DEV_ADMIN_LOGIN: "true",
      }),
    ).toBe(true);
    expect(
      isDevelopmentAdminRouteEnabled({
        NODE_ENV: "staging",
        DEV_ADMIN_LOGIN: "true",
      }),
    ).toBe(false);
  });

  test("los detalles y tokens sin sesion fallan cerrados fuera de desarrollo", () => {
    expect(canExposeArchitectureDetails({ NODE_ENV: "development" })).toBe(
      true,
    );
    expect(canExposeArchitectureDetails({ NODE_ENV: "staging" })).toBe(false);
    expect(canExposeArchitectureDetails({ NODE_ENV: "production" })).toBe(
      false,
    );
    expect(requiresSessionBoundToken({ NODE_ENV: "production" })).toBe(true);
    expect(requiresSessionBoundToken({ NODE_ENV: "development" })).toBe(false);
  });

  test("el router no registra dev-admin en produccion aunque exista opt-in", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDevAdminLogin = process.env.DEV_ADMIN_LOGIN;
    process.env.NODE_ENV = "production";
    process.env.DEV_ADMIN_LOGIN = "true";
    try {
      const { default: router } = await import(
        `../src/routes/auth.js?production=${Date.now()}`
      );
      const registeredPaths = router.stack
        .map((layer) => layer.route?.path)
        .filter(Boolean);
      expect(registeredPaths).not.toContain("/dev-admin");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDevAdminLogin === undefined) {
        delete process.env.DEV_ADMIN_LOGIN;
      } else {
        process.env.DEV_ADMIN_LOGIN = previousDevAdminLogin;
      }
    }
  });

  test("el servidor falla antes de conectarse si JWT_SECRET es debil", () => {
    const weakSecret = "unsafe";
    const result = spawnSync(process.execPath, ["src/server.js"], {
      cwd: backendRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        JWT_SECRET: weakSecret,
      },
      encoding: "utf8",
      timeout: 15000,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/JWT_SECRET no cumple los requisitos/);
    expect(output).not.toContain(weakSecret);
    expect(output).not.toMatch(/MongoDB connected/);
  });
});
