import jwt from "jsonwebtoken";
import User from "../models/User.js";

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
      assignedTrainerId: user.assignedTrainerId || null,
      sessionId: decoded.sid || null,
    };
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

export const scopedOwnerFilter = (req, baseFilter = {}) => {
  return { ...baseFilter, ownerId: req.user.id };
};

export const getAccessibleOwnerFilter = async (req, baseFilter = {}) => {
  return { ...baseFilter, ownerId: req.user.id };
};

export const ensureCanAccessOwner = async (req, ownerId) => {
  if (!ownerId) return false;
  return String(ownerId) === req.user?.id;
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
