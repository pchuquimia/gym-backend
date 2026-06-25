import jwt from "jsonwebtoken";
import User from "../models/User.js";

const getTokenFromRequest = (req) => req.cookies?.jwt || null;

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

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      assignedTrainerId: user.assignedTrainerId || null,
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
  if (user.role === "Admin") return true;
  if (!ownerId) return false;
  if (user.role === "Cliente") return String(ownerId) === user.id;
  if (user.role === "Entrenador") return String(ownerId) === user.id;
  return false;
};

export const scopedOwnerFilter = (req, baseFilter = {}) => {
  if (req.user?.role === "Admin") return { ...baseFilter };
  return { ...baseFilter, ownerId: req.user.id };
};

export const getAccessibleOwnerFilter = async (req, baseFilter = {}) => {
  if (req.user?.role === "Admin") return { ...baseFilter };
  if (req.user?.role === "Entrenador") {
    const clients = await User.find(
      { assignedTrainerId: req.user.id, isActive: true },
      "_id",
    ).lean();
    const ownerIds = [
      req.user.id,
      ...clients.map((client) => client._id.toString()),
    ];
    return { ...baseFilter, ownerId: { $in: ownerIds } };
  }
  return { ...baseFilter, ownerId: req.user.id };
};

export const ensureCanAccessOwner = async (req, ownerId) => {
  if (req.user?.role === "Admin") return true;
  if (!ownerId) return false;
  if (req.user?.role === "Cliente") return String(ownerId) === req.user.id;
  if (req.user?.role === "Entrenador") {
    if (String(ownerId) === req.user.id) return true;
    const client = await User.exists({
      _id: ownerId,
      assignedTrainerId: req.user.id,
      isActive: true,
    });
    return Boolean(client);
  }
  return false;
};

export const checkOwnership =
  (Model, { ownerField = "ownerId", param = "id" } = {}) =>
  async (req, _res, next) => {
    try {
      if (req.user?.role === "Admin") return next();
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
