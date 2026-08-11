import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Photo from "../models/Photo.js";
import Training from "../models/Training.js";
import { createDemoWorkspace } from "../services/demoWorkspaceService.js";
import asyncHandler from "../utils/asyncHandler.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookies.js";
import {
  isEmailConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../utils/email.js";
import {
  DEMO_ROLES,
  isDemoRequestOriginAllowed,
  isDemoModeEnabled,
  isDemoRole,
} from "../utils/demoMode.js";

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

const persistLoginSession = (userId, session, fields = {}) =>
  User.updateOne(
    { _id: userId },
    {
      $set: fields,
      $push: {
        activeSessions: {
          $each: [session],
          $position: 0,
          $slice: 10,
        },
      },
    },
  );

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

const getClientUrl = () =>
  String(process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");

const requestPasswordReset = asyncHandler(async (req, res) => {
  if (!isEmailConfigured()) {
    const err = new Error(
      "La recuperación por correo no está configurada temporalmente.",
    );
    err.statusCode = 503;
    throw err;
  }

  const user = await User.findOne({ email: req.body.email }).select(
    "+passwordResetToken +passwordResetExpiresAt",
  );

  if (!user) {
    return res.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  user.passwordResetToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${getClientUrl()}/restablecer-contrasena?token=${token}`;

  try {
    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetUrl,
    });
  } catch (err) {
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await user.save({ validateBeforeSave: false });
    console.error("No se pudo enviar el correo de recuperación", err);
    return res.json({ ok: true });
  }

  const payload = { ok: true };
  if (process.env.NODE_ENV !== "production" && isEmailConfigured()) {
    payload.previewUrl = resetUrl;
  }
  res.json(payload);
});

const resetPassword = asyncHandler(async (req, res) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.body.token)
    .digest("hex");
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+password +passwordResetToken +passwordResetExpiresAt");

  if (!user) {
    const err = new Error("El enlace es inválido o ha vencido.");
    err.statusCode = 400;
    throw err;
  }

  user.password = req.body.password;
  user.passwordChangedAt = new Date();
  user.passwordResetToken = null;
  user.passwordResetExpiresAt = null;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.activeSessions = [];
  await user.save();

  clearAuthCookie(res);
  res.json({ ok: true });
});

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.exists({ email });
  if (existing) {
    const err = new Error("El email ya está registrado");
    err.statusCode = 409;
    throw err;
  }

  const verificationRequired =
    isEmailConfigured() &&
    String(process.env.EMAIL_VERIFICATION_REQUIRED || "true").toLowerCase() !==
      "false";
  const verificationToken = verificationRequired
    ? crypto.randomBytes(32).toString("hex")
    : "";
  const user = await User.create({
    name,
    email,
    password,
    role: "Cliente",
    trainingMode: "independent",
    emailVerificationRequired: verificationRequired,
    emailVerificationToken: verificationRequired
      ? crypto.createHash("sha256").update(verificationToken).digest("hex")
      : null,
    emailVerificationExpiresAt: verificationRequired
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : null,
  });

  if (verificationRequired) {
    const verifyUrl = `${getClientUrl()}/verificar-correo?token=${verificationToken}`;
    try {
      await sendVerificationEmail({
        email: user.email,
        name: user.name,
        verifyUrl,
      });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
    return res.status(201).json({
      verificationRequired: true,
      email: user.email,
    });
  }

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

  if (user.emailVerificationRequired) {
    const err = new Error("Debes verificar tu correo antes de iniciar sesión.");
    err.statusCode = 403;
    throw err;
  }

  const lastLoginAt = new Date();
  const session = createSession(req);
  await persistLoginSession(user._id, session, {
    failedLoginAttempts: 0,
    lockUntil: null,
    lastLoginAt,
  });
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = lastLoginAt;

  const token = signToken(user, session.sessionId);
  setAuthCookie(res, token);
  res.json(authResponse(user, token));
});

const demoStatus = (req, res) => {
  const enabled = isDemoModeEnabled() && isDemoRequestOriginAllowed(req);
  res.set("Cache-Control", "no-store");
  res.json({
    enabled,
    roles: enabled ? Object.keys(DEMO_ROLES) : [],
  });
};

const demoLogin = asyncHandler(async (req, res) => {
  if (!isDemoModeEnabled()) {
    const err = new Error("La demostracion publica no esta habilitada");
    err.statusCode = 404;
    throw err;
  }
  if (!isDemoRequestOriginAllowed(req)) {
    const err = new Error(
      "Este acceso demo solo esta disponible desde el sitio autorizado",
    );
    err.statusCode = 403;
    throw err;
  }
  const role = String(req.body.role || "").trim();
  if (!isDemoRole(role)) {
    const err = new Error("Rol de demostracion invalido");
    err.statusCode = 400;
    throw err;
  }

  const { user, expiresAt } = await createDemoWorkspace(role);
  const session = createSession(req);
  user.activeSessions = [session];
  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user, session.sessionId);
  setAuthCookie(res, token);
  res.set("Cache-Control", "no-store");
  res.status(201).json({
    ...authResponse(user, token),
    demo: { expiresAt },
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.body.token)
    .digest("hex");
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpiresAt: { $gt: new Date() },
    emailVerificationRequired: true,
  }).select("+emailVerificationToken +emailVerificationExpiresAt");

  if (!user) {
    const err = new Error(
      "El enlace de verificación es inválido o ha vencido.",
    );
    err.statusCode = 400;
    throw err;
  }

  user.emailVerificationRequired = false;
  user.emailVerificationToken = null;
  user.emailVerificationExpiresAt = null;
  user.emailVerifiedAt = new Date();
  const session = createSession(req);
  user.activeSessions = [session, ...(user.activeSessions || [])].slice(0, 10);
  await user.save({ validateBeforeSave: false });

  const token = signToken(user, session.sessionId);
  setAuthCookie(res, token);
  res.json(authResponse(user, token));
});

const devAdminLogin = asyncHandler(async (req, res) => {
  const isDevAdminEnabled =
    process.env.NODE_ENV !== "production" ||
    String(process.env.DEV_ADMIN_LOGIN || "").toLowerCase() === "true";
  const host = req.hostname;
  const ip = req.ip || "";
  const isPrivateNetworkAddress = (value = "") =>
    /^(::ffff:)?(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(
      String(value),
    );
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "::ffff:127.0.0.1" ||
    isPrivateNetworkAddress(host) ||
    isPrivateNetworkAddress(ip);

  if (!isDevAdminEnabled || !isLocal) {
    const err = new Error("No autorizado");
    err.statusCode = 403;
    throw err;
  }

  const email = process.env.DEV_ADMIN_EMAIL || "admin@gym.com";
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: "Administrador Gym",
      email,
      password: `Dev#${crypto.randomUUID()}!`,
      role: "Admin",
      isActive: true,
    });
  }

  const lastLoginAt = new Date();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        role: "Admin",
        isActive: true,
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt,
      },
    },
  );
  user.role = "Admin";
  user.isActive = true;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = lastLoginAt;

  // Development access must not evict real device sessions on repeated reloads.
  const token = signToken(user, null);
  setAuthCookie(res, token);
  res.set("Cache-Control", "no-store");
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
  res.json({
    profile: user.profile,
    security: user.security,
    capabilities: { emailChange: isEmailConfigured() },
  });
});

const getProfileSummary = asyncHandler(async (req, res) => {
  const ownerId = req.user.id;
  const [workouts, trainingDates] = await Promise.all([
    Training.countDocuments({ ownerId }),
    Training.distinct("date", { ownerId }),
  ]);
  res.set("Cache-Control", "no-store");
  res.json({
    workouts,
    trainingDates: trainingDates.filter(Boolean),
  });
});

const updateAccount = asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.user.id).select(
    "+emailVerificationToken +emailVerificationExpiresAt",
  );
  if (!currentUser) return res.status(404).json({ error: "No encontrado" });
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
    payload.name = req.body.name;
  }
  const emailChanged =
    Object.prototype.hasOwnProperty.call(req.body, "email") &&
    req.body.email !== currentUser.email;
  let verificationToken = "";
  if (emailChanged) {
    if (!isEmailConfigured()) {
      const err = new Error(
        "El cambio de correo requiere configurar el servicio de email.",
      );
      err.statusCode = 503;
      throw err;
    }
    verificationToken = crypto.randomBytes(32).toString("hex");
    payload.email = req.body.email;
    payload.emailVerificationRequired = true;
    payload.emailVerificationToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    payload.emailVerificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );
  }
  const profileFields = ["birthDate", "weight", "height", "avatarPhotoId"];
  if (req.body.avatarPhotoId) {
    const photo = await Photo.exists({
      _id: req.body.avatarPhotoId,
      ownerId: req.user.id,
    });
    if (!photo) {
      const err = new Error("La foto seleccionada no pertenece a tu cuenta");
      err.statusCode = 400;
      throw err;
    }
  }
  profileFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      payload[`profile.${field}`] = req.body[field];
    }
  });
  const user = await User.findByIdAndUpdate(req.user.id, payload, {
    new: true,
    runValidators: true,
  });
  if (!user) return res.status(404).json({ error: "No encontrado" });
  if (emailChanged) {
    const verifyUrl = `${getClientUrl()}/verificar-correo?token=${verificationToken}`;
    try {
      await sendVerificationEmail({
        email: user.email,
        name: user.name,
        verifyUrl,
      });
    } catch (err) {
      await User.findByIdAndUpdate(req.user.id, {
        email: currentUser.email,
        emailVerificationRequired: currentUser.emailVerificationRequired,
        emailVerificationToken: currentUser.emailVerificationToken || null,
        emailVerificationExpiresAt:
          currentUser.emailVerificationExpiresAt || null,
      });
      throw err;
    }
  }
  res.json({
    user: sanitizeUser(user),
    profile: user.profile,
    security: user.security,
    emailVerificationRequired: emailChanged,
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = [
    "birthDate",
    "weight",
    "height",
    "goal",
    "calories",
    "units",
    "language",
    "privacy",
    "notifications",
    "avatarPhotoId",
  ];
  const payload = {};
  if (req.body.avatarPhotoId) {
    const photo = await Photo.exists({
      _id: req.body.avatarPhotoId,
      ownerId: req.user.id,
    });
    if (!photo) {
      const err = new Error("La foto seleccionada no pertenece a tu cuenta");
      err.statusCode = 400;
      throw err;
    }
  }
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
      ? [
          {
            ...(currentSession.toObject?.() || currentSession),
            lastSeenAt: new Date(),
          },
        ]
      : [];
    await user.save();
  }
  res.json({ ok: true });
});

export {
  register,
  login,
  demoLogin,
  demoStatus,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  devAdminLogin,
  logout,
  me,
  getProfile,
  updateProfile,
  getProfileSummary,
  updateAccount,
  updateSecurity,
  changePassword,
  getSessions,
  logoutAll,
};
