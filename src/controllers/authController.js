import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookies.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;

const signToken = (user, sessionId) =>
  jwt.sign(
    { id: user._id.toString(), role: user.role, sid: sessionId },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.COOKIE_EXPIRES || "7d",
    },
  );

const sanitizeUser = (user) =>
  typeof user.toSafeJSON === "function" ? user.toSafeJSON() : user;

const shouldExposeToken = () =>
  ["true", "1", "yes"].includes(
    String(process.env.AUTH_EXPOSE_TOKEN || "").toLowerCase(),
  );

const authResponse = (user, token) => {
  const payload = { user: sanitizeUser(user) };
  if (shouldExposeToken()) payload.token = token;
  return payload;
};

const parseDevice = (userAgent = "") => {
  const ua = String(userAgent);
  const isIphone = /iphone/i.test(ua);
  const isIpad = /ipad|macintosh.*mobile/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isMac = /macintosh|mac os/i.test(ua);
  const isWindows = /windows/i.test(ua);
  const browser = /edg/i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /safari/i.test(ua)
        ? "Safari"
        : /firefox|fxios/i.test(ua)
          ? "Firefox"
          : "Navegador";
  const os = isIphone
    ? "iOS"
    : isIpad
      ? "iPadOS"
      : isAndroid
        ? "Android"
        : isMac
          ? "macOS"
          : isWindows
            ? "Windows"
            : "";
  const device = isIphone
    ? "iPhone"
    : isIpad
      ? "iPad"
      : isAndroid
        ? "Android"
        : isMac
          ? "Mac"
          : isWindows
            ? "Windows PC"
            : "Dispositivo";
  return { device, browser, os };
};

const getTokenFromRequest = (req) => {
  if (req.cookies?.jwt) return req.cookies.jwt;
  const authorization = req.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return null;
};

const createSession = (req) => {
  const sessionId = crypto.randomUUID();
  const userAgent = req.get("user-agent") || "";
  const details = parseDevice(userAgent);
  return {
    sessionId,
    ...details,
    ip: req.ip || "",
    userAgent,
    createdAt: new Date(),
    lastSeenAt: new Date(),
  };
};

const invalidCredentials = () => {
  const err = new Error("Credenciales inválidas");
  err.statusCode = 401;
  return err;
};

const lockedError = () => {
  const err = new Error("Cuenta bloqueada temporalmente. Intenta más tarde.");
  err.statusCode = 423;
  return err;
};

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.exists({ email });
  if (existing) {
    const err = new Error("El email ya está registrado");
    err.statusCode = 409;
    throw err;
  }

  const user = await User.create({
    name,
    email,
    password,
    role: "Cliente",
  });

  const session = createSession(req);
  user.activeSessions = [session];
  await user.save();

  const token = signToken(user, session.sessionId);
  setAuthCookie(res, token);
  res.status(201).json(authResponse(user, token));
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select("+password");

  if (!user) throw invalidCredentials();
  if (!user.isActive) throw invalidCredentials();
  if (user.lockUntil && user.lockUntil > new Date()) throw lockedError();

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
    }
    await user.save();
    throw invalidCredentials();
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  const session = createSession(req);
  user.activeSessions = [session, ...(user.activeSessions || [])].slice(0, 10);
  await user.save();

  const token = signToken(user, session.sessionId);
  setAuthCookie(res, token);
  res.json(authResponse(user, token));
});

const logout = asyncHandler(async (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.id && decoded?.sid) {
        await User.findByIdAndUpdate(decoded.id, {
          $pull: { activeSessions: { sessionId: decoded.sid } },
        });
      }
    } catch {
      // La cookie igualmente se limpia aunque el token ya no sea valido.
    }
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.isActive) {
    const err = new Error("No autenticado");
    err.statusCode = 401;
    throw err;
  }
  if (req.user.sessionId) {
    user.activeSessions = (user.activeSessions || []).map((session) =>
      session.sessionId === req.user.sessionId
        ? { ...(session.toObject?.() || session), lastSeenAt: new Date() }
        : session,
    );
    await user.save();
  }
  res.set("Cache-Control", "no-store");
  res.json({ user: sanitizeUser(user) });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select("profile security");
  if (!user) return res.status(404).json({ error: "No encontrado" });
  res.set("Cache-Control", "no-store");
  res.json({ profile: user.profile, security: user.security });
});

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = [
    "birthDate",
    "weight",
    "height",
    "goal",
    "calories",
    "units",
    "privacy",
    "notifications",
  ];
  const payload = {};
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      payload[`profile.${key}`] = req.body[key];
    }
  });
  const user = await User.findByIdAndUpdate(req.user.id, payload, {
    new: true,
    runValidators: true,
  }).select("profile security");
  res.json({ profile: user.profile, security: user.security });
});

const updateSecurity = asyncHandler(async (req, res) => {
  const payload = {};
  ["biometricEnabled", "twoFactorEnabled"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      payload[`security.${key}`] = Boolean(req.body[key]);
    }
  });
  const user = await User.findByIdAndUpdate(req.user.id, payload, {
    new: true,
    runValidators: true,
  }).select("profile security");
  res.json({ profile: user.profile, security: user.security });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, password } = req.body;
  const user = await User.findById(req.user.id).select("+password");
  if (!user) return res.status(404).json({ error: "No encontrado" });
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    const err = new Error("Credenciales inválidas");
    err.statusCode = 401;
    throw err;
  }
  user.password = password;
  user.passwordChangedAt = new Date();
  if (req.user.sessionId) {
    user.activeSessions = (user.activeSessions || []).filter(
      (session) => session.sessionId === req.user.sessionId,
    );
  }
  await user.save();
  res.json({ ok: true, passwordChangedAt: user.passwordChangedAt });
});

const getSessions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select("activeSessions");
  const sessions = (user?.activeSessions || [])
    .slice()
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    .map((session) => ({
      id: session.sessionId,
      device: session.device,
      browser: session.browser,
      os: session.os,
      ip: session.ip,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      current: session.sessionId === req.user.sessionId,
    }));
  res.set("Cache-Control", "no-store");
  res.json({ sessions });
});

const logoutAll = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select("activeSessions");
  const currentSession = (user?.activeSessions || []).find(
    (session) => session.sessionId === req.user.sessionId,
  );
  if (user) {
    user.activeSessions = currentSession
      ? [{ ...(currentSession.toObject?.() || currentSession), lastSeenAt: new Date() }]
      : [];
    await user.save();
  }
  res.json({ ok: true });
});

export {
  register,
  login,
  logout,
  me,
  getProfile,
  updateProfile,
  updateSecurity,
  changePassword,
  getSessions,
  logoutAll,
};
