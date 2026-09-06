import { assertSecureAdminPassword } from "./security.js";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const getAdminBootstrapConfig = (
  env = process.env,
  { requirePassword = false } = {},
) => {
  const email = normalizeEmail(env.ADMIN_EMAIL);
  const password = String(env.ADMIN_PASSWORD || "");
  const name = String(env.ADMIN_NAME || "Administrador RIRFIT").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL es obligatorio y debe ser valido");
  }
  if (!name || name.length > 80) {
    throw new Error("ADMIN_NAME debe tener entre 1 y 80 caracteres");
  }
  if (requirePassword || password) assertSecureAdminPassword(password);

  return { email, name, password: password || null };
};

export const applyAdminCredentialRotation = (
  admin,
  password,
  changedAt = new Date(),
) => {
  assertSecureAdminPassword(password);
  admin.password = password;
  admin.passwordChangedAt = changedAt;
  admin.activeSessions = [];
  admin.failedLoginAttempts = 0;
  admin.lockUntil = null;
  admin.passwordResetToken = null;
  admin.passwordResetExpiresAt = null;
  admin.role = "Admin";
  admin.isActive = true;
  return admin;
};
