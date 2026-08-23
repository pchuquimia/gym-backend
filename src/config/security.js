const JWT_SECRET_MIN_BYTES = 32;
const JWT_SECRET_MIN_ENTROPY_BITS = 120;
const ADMIN_PASSWORD_MIN_BYTES = 16;
const ADMIN_PASSWORD_MIN_ENTROPY_BITS = 70;

const byteLength = (value) => Buffer.byteLength(String(value || ""), "utf8");

export const estimateShannonEntropyBits = (value) => {
  const text = String(value || "");
  if (!text) return 0;
  const frequencies = new Map();
  for (const character of text) {
    frequencies.set(character, (frequencies.get(character) || 0) + 1);
  }
  let bitsPerCharacter = 0;
  for (const count of frequencies.values()) {
    const probability = count / text.length;
    bitsPerCharacter -= probability * Math.log2(probability);
  }
  return bitsPerCharacter * text.length;
};

const looksLikePlaceholder = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    /^(change-?me|replace-?me|secret|jwt-?secret|development|test)+$/.test(
      normalized,
    ) ||
    normalized.includes("replace-with") ||
    normalized.includes("your-secret") ||
    normalized.includes("example")
  );
};

const assertSecretStrength = (
  value,
  {
    label,
    minBytes,
    minEntropyBits,
    maxBytes = Number.POSITIVE_INFINITY,
  },
) => {
  const failures = [];
  const bytes = byteLength(value);
  if (bytes < minBytes) failures.push(`minimo ${minBytes} bytes`);
  if (bytes > maxBytes) failures.push(`maximo ${maxBytes} bytes`);
  if (looksLikePlaceholder(value)) failures.push("no puede ser un placeholder");
  if (estimateShannonEntropyBits(value) < minEntropyBits) {
    failures.push(`entropia estimada minima de ${minEntropyBits} bits`);
  }
  if (failures.length) {
    throw new Error(
      `${label} no cumple los requisitos de seguridad: ${failures.join(", ")}`,
    );
  }
};

export const assertSecureJwtSecret = (value) =>
  assertSecretStrength(value, {
    label: "JWT_SECRET",
    minBytes: JWT_SECRET_MIN_BYTES,
    minEntropyBits: JWT_SECRET_MIN_ENTROPY_BITS,
  });

export const assertSecureAdminPassword = (value) =>
  assertSecretStrength(value, {
    label: "ADMIN_PASSWORD",
    minBytes: ADMIN_PASSWORD_MIN_BYTES,
    minEntropyBits: ADMIN_PASSWORD_MIN_ENTROPY_BITS,
    maxBytes: 72,
  });

export const isDevelopmentEnvironment = (env = process.env) =>
  env.NODE_ENV === "development";

export const isDevelopmentAdminRouteEnabled = (env = process.env) =>
  isDevelopmentEnvironment(env) &&
  String(env.DEV_ADMIN_LOGIN || "").trim().toLowerCase() === "true";

export const canExposeArchitectureDetails = (env = process.env) =>
  isDevelopmentEnvironment(env);

export const requiresSessionBoundToken = (env = process.env) =>
  env.NODE_ENV === "production";

export const SECURITY_REQUIREMENTS = Object.freeze({
  jwtSecretMinBytes: JWT_SECRET_MIN_BYTES,
  jwtSecretMinEntropyBits: JWT_SECRET_MIN_ENTROPY_BITS,
  adminPasswordMinBytes: ADMIN_PASSWORD_MIN_BYTES,
  adminPasswordMinEntropyBits: ADMIN_PASSWORD_MIN_ENTROPY_BITS,
});
