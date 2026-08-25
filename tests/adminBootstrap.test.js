import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAdminCredentialRotation,
  getAdminBootstrapConfig,
} from "../src/config/adminBootstrap.js";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("secure admin bootstrap", () => {
  test("requiere un email explicito", () => {
    expect(() =>
      getAdminBootstrapConfig(
        { ADMIN_PASSWORD: crypto.randomBytes(32).toString("base64url") },
        { requirePassword: true },
      ),
    ).toThrow(/ADMIN_EMAIL/);
  });

  test("requiere una contrasena fuerte al crear o rotar", () => {
    expect(() =>
      getAdminBootstrapConfig(
        { ADMIN_EMAIL: "security-test@example.invalid" },
        { requirePassword: true },
      ),
    ).toThrow(/ADMIN_PASSWORD/);
  });

  test("acepta configuracion explicita y normaliza el email", () => {
    const password = crypto.randomBytes(32).toString("base64url");
    const config = getAdminBootstrapConfig(
      {
        ADMIN_EMAIL: "  SECURITY-TEST@EXAMPLE.INVALID ",
        ADMIN_PASSWORD: password,
        ADMIN_NAME: "Administrador de seguridad",
      },
      { requirePassword: true },
    );
    expect(config).toEqual({
      email: "security-test@example.invalid",
      name: "Administrador de seguridad",
      password,
    });
  });

  test("la rotacion revoca sesiones y artefactos de recuperacion", () => {
    const password = crypto.randomBytes(32).toString("base64url");
    const changedAt = new Date("2026-01-01T00:00:00.000Z");
    const admin = {
      activeSessions: [{ sessionId: "test-session" }],
      failedLoginAttempts: 4,
      lockUntil: new Date("2026-01-02T00:00:00.000Z"),
      passwordResetToken: "hashed-test-token",
      passwordResetExpiresAt: new Date("2026-01-02T00:00:00.000Z"),
      role: "Cliente",
      isActive: false,
    };

    applyAdminCredentialRotation(admin, password, changedAt);

    expect(admin).toMatchObject({
      password,
      passwordChangedAt: changedAt,
      activeSessions: [],
      failedLoginAttempts: 0,
      lockUntil: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      role: "Admin",
      isActive: true,
    });
  });

  test("el script no contiene una contrasena literal ni la imprime", () => {
    const source = fs.readFileSync(
      path.join(backendRoot, "scripts", "createAdminAndAssignData.js"),
      "utf8",
    );
    expect(source).not.toMatch(/password\s*:\s*["'][^"']+["']/i);
    expect(source).not.toMatch(
      /console\.(?:log|error)\([^\n]*(?:config\.password|ADMIN_PASSWORD)/i,
    );
  });
});
