import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { getDemoRestriction } from "../utils/demoMode.js";

const getTokenFromRequest = (req) => {
  if (req.cookies?.jwt) return req.cookies.jwt;

  const authorization = req.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return null;
};

export const protect = async (req, _res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      const err = new Error("No autenticado");
      err.statusCode = 401;
      return next(err);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user || !user.isActive) {
      const err = new Error("No autenticado");
      err.statusCode = 401;
      return next(err);
    }
    if (user.isDemo && user.demoExpiresAt && user.demoExpiresAt <= new Date()) {
      const err = new Error("La sesion demo ha vencido");
      err.statusCode = 401;
      return next(err);
    }
    if (decoded.sid) {
      const hasSession = (user.activeSessions || []).some(
        (session) => session.sessionId === decoded.sid,
      );
      if (!hasSession) {
        const err = new Error("No autenticado");
        err.statusCode = 401;
        return next(err);
      }
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isDemo: Boolean(user.isDemo),
      demoWorkspaceId: user.isDemo ? user.demoWorkspaceId || null : null,
      demoExpiresAt: user.isDemo ? user.demoExpiresAt || null : null,
      assignedTrainerId: user.assignedTrainerId || null,
      trainingMode:
        user.role === "Cliente" && user.assignedTrainerId
          ? "coach_managed"
          : user.trainingMode || "independent",
      profile: {
        language: user.profile?.language === "en" ? "en" : "es",
      },
      sessionId: decoded.sid || null,
    };

    if (req.user.isDemo) {
      const restriction = getDemoRestriction(req);
      if (restriction) {
        const err = new Error(restriction);
        err.statusCode = 403;
        err.code = "DEMO_ACTION_RESTRICTED";
        return next(err);
      }
    }
    next();
  } catch (_err) {
    const err = new Error("No autenticado");
    err.statusCode = 401;
    next(err);
  }
};

export const authorizeRoles =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      const err = new Error("No autorizado");
      err.statusCode = 403;
      return next(err);
    }
    next();
  };

export const canAccessOwner = (user, ownerId) => {
  if (!user) return false;
  if (!ownerId) return false;
  return String(ownerId) === user.id;
};

const getRequestedAthleteId = (req) =>
  String(req.query?.athleteId || req.body?.ownerId || "").trim();

export const scopedOwnerFilter = (req, baseFilter = {}) => {
  return { ...baseFilter, ownerId: req.user.id };
};

export const getAccessibleOwnerFilter = async (req, baseFilter = {}) => {
  const requestedOwnerId = getRequestedAthleteId(req);
  if (!requestedOwnerId) return { ...baseFilter, ownerId: req.user.id };
  if (!(await ensureCanAccessOwner(req, requestedOwnerId))) {
    const err = new Error("No autorizado para acceder a este atleta");
    err.statusCode = 403;
    throw err;
  }
  return { ...baseFilter, ownerId: requestedOwnerId };
};

export const ensureCanAccessOwner = async (req, ownerId) => {
  if (!ownerId) return false;
  if (String(ownerId) === req.user?.id) return true;
  if (!["Admin", "Entrenador"].includes(req.user?.role)) return false;
  const athlete = await User.exists({
    _id: ownerId,
    role: "Cliente",
    assignedTrainerId: req.user.id,
    isActive: true,
    ...(req.user.isDemo
      ? {
          isDemo: true,
          demoWorkspaceId: req.user.demoWorkspaceId,
        }
      : {}),
  });
  return Boolean(athlete);
};

export const checkOwnership =
  (Model, { ownerField = "ownerId", param = "id" } = {}) =>
  async (req, _res, next) => {
    try {
      const doc = await Model.findById(req.params[param], ownerField).lean();
      if (!doc) {
        const err = new Error("No encontrado");
        err.statusCode = 404;
        return next(err);
      }
      if (!(await ensureCanAccessOwner(req, doc[ownerField]))) {
        const err = new Error("No autorizado");
        err.statusCode = 403;
        return next(err);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
