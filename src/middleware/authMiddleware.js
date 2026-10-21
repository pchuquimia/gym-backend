import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { measureDatabase } from "./performanceTiming.js";
import { getDemoRestriction } from "../utils/demoMode.js";
import {
  getEffectiveSubscription,
  getEntitlements,
  hasPremiumFeature,
} from "../utils/subscription.js";
import { requiresSessionBoundToken } from "../config/security.js";
import { loadCachedAuthenticationUser } from "../services/authenticationUserCache.js";

const AUTH_USER_FIELD_LIST = [
  "name",
  "email",
  "role",
  "isActive",
  "isDemo",
  "demoWorkspaceId",
  "demoExpiresAt",
  "assignedTrainerId",
  "trainingMode",
  "profile.language",
  "activeSessions",
  "subscription",
];
const CURRENT_USER_FIELDS = [
  ...AUTH_USER_FIELD_LIST.filter((field) => field !== "profile.language"),
  "username",
  "onboarding",
  "coachIntake",
  "coachCode",
  "lastLoginAt",
  "profile",
  "security",
  "emailPreferences",
  "passwordChangedAt",
  "emailVerificationRequired",
  "emailVerifiedAt",
  "createdAt",
  "updatedAt",
].join(" ");

const loadAuthenticationUser = (userId, sessionId, res) =>
  loadCachedAuthenticationUser({
    userId,
    sessionId,
    loader: () =>
      measureDatabase(res, () =>
        User.findById(userId, CURRENT_USER_FIELDS).lean().exec(),
      ),
  });

const getTokenFromRequest = (req) => {
  if (req.cookies?.jwt) return req.cookies.jwt;

  const authorization = req.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return null;
};

const sessionError = (code, message = "No autenticado") =>
  Object.assign(new Error(message), { statusCode: 401, code });

export const protect = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return next(sessionError("AUTH_SESSION_MISSING"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (requiresSessionBoundToken() && !decoded.sid) {
      return next(sessionError("AUTH_SESSION_INVALID"));
    }
    // Initial screens issue several protected requests in parallel. Sharing the
    // same in-flight user lookup removes duplicate Atlas round trips without
    // caching permissions after the request burst has finished.
    const user = await loadAuthenticationUser(decoded.id, decoded.sid, res);
    if (!user || !user.isActive) {
      return next(sessionError("AUTH_ACCOUNT_UNAVAILABLE"));
    }
    if (user.isDemo && user.demoExpiresAt && user.demoExpiresAt <= new Date()) {
      return next(sessionError("AUTH_DEMO_EXPIRED", "La sesion demo ha vencido"));
    }
    if (decoded.sid) {
      const hasSession = (user.activeSessions || []).some(
        (session) => session.sessionId === decoded.sid,
      );
      if (!hasSession) {
        return next(sessionError("AUTH_SESSION_REVOKED"));
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
      subscription: getEffectiveSubscription(user),
      entitlements: getEntitlements(user),
    };
    req.authenticatedUser = user;

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
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(sessionError("AUTH_SESSION_EXPIRED"));
    }
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
      return next(sessionError("AUTH_SESSION_INVALID"));
    }
    // A database/network failure does not invalidate the user's credentials.
    next(Object.assign(new Error("No pudimos verificar tu sesión. Intenta nuevamente."), {
      statusCode: 503,
      code: "AUTH_VERIFICATION_UNAVAILABLE",
      cause: error,
    }));
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

export const requireFeature = (feature) => (req, _res, next) => {
  if (hasPremiumFeature(req.user, feature)) return next();
  const err = new Error("Esta funcionalidad requiere un plan premium");
  err.statusCode = 403;
  err.code = "PREMIUM_FEATURE_REQUIRED";
  err.details = { feature };
  next(err);
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
