const truthy = new Set(["1", "true", "yes", "on"]);

export const isDemoModeEnabled = () =>
  truthy.has(
    String(process.env.DEMO_MODE || "")
      .trim()
      .toLowerCase(),
  );

export const getDemoLifetimeHours = () => {
  const value = Number(process.env.DEMO_WORKSPACE_HOURS || 12);
  return Number.isFinite(value) && value >= 1 && value <= 168 ? value : 12;
};

export const DEMO_ROLES = Object.freeze({
  athlete: "Cliente",
  coach: "Entrenador",
  admin: "Admin",
});

export const isDemoRole = (value) =>
  Object.prototype.hasOwnProperty.call(DEMO_ROLES, String(value || ""));

const normalizeOrigin = (value) =>
  String(value || "")
    .trim()
    .replace(/\/$/, "");

export const getDemoAllowedOrigins = () =>
  String(process.env.DEMO_CLIENT_URL || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

export const isDemoRequestOriginAllowed = (req) => {
  const allowedOrigins = getDemoAllowedOrigins();
  if (!allowedOrigins.length) return true;

  const origin = normalizeOrigin(req.get?.("origin"));
  if (!origin) return process.env.NODE_ENV !== "production";
  if (allowedOrigins.includes(origin)) return true;

  return (
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
};

const blockedAuthPaths = new Set([
  "/account",
  "/profile",
  "/security",
  "/change-password",
  "/logout-all",
]);

export const getDemoRestriction = ({ method, baseUrl, path }) => {
  const verb = String(method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(verb)) return "";

  if (baseUrl === "/api/users")
    return "La gestion de cuentas no esta disponible en la demo.";
  if (baseUrl === "/api/exercises")
    return "El catalogo compartido esta protegido en la demo.";
  if (baseUrl === "/api/photos")
    return "La carga de imagenes esta desactivada en la demo.";
  if (baseUrl === "/api/plan-templates")
    return "Las plantillas globales estan protegidas en la demo.";
  if (baseUrl === "/api/auth" && blockedAuthPaths.has(path)) {
    return "Los datos de acceso de la cuenta demo no se pueden modificar.";
  }
  if (
    baseUrl === "/api/coach" &&
    (path === "/relationship" || path === "/link-code/regenerate")
  ) {
    return "Las relaciones entre cuentas estan protegidas en la demo.";
  }

  return "";
};
