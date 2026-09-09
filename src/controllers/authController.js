import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Photo from "../models/Photo.js";
import Training from "../models/Training.js";
import { createDemoWorkspace } from "../services/demoWorkspaceService.js";
import { verifyGoogleCredential } from "../services/googleAuthService.js";
import {
  createFacebookAuthorizationUrl,
  verifyFacebookAuthorizationCode,
} from "../services/facebookAuthService.js";
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
import { isDevelopmentAdminRouteEnabled } from "../config/security.js";
import { normalizeAuthEmail } from "../utils/normalizeAuthEmail.js";
import { normalizeUsername } from "../utils/normalizeUsername.js";
import { ensureCoachCode } from "../utils/coachCode.js";

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

const authResponse = (user, token) => ({
  user: sanitizeUser(user),
  token,
});

const ensureShareableAvatarPhoto = async (userId, avatarPhotoId) => {
  if (!avatarPhotoId) return null;
  const photo = await Photo.findOneAndUpdate(
    { _id: avatarPhotoId, ownerId: userId },
    { $set: { visibility: "coach" } },
    { new: true, runValidators: true },
  );
  if (photo) return photo;
  const error = new Error("La foto seleccionada no pertenece a tu cuenta");
  error.statusCode = 400;
  throw error;
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

const FACEBOOK_STATE_COOKIE = "rirfit_facebook_oauth_state";
const FACEBOOK_REMEMBER_COOKIE = "rirfit_facebook_oauth_remember";
const FACEBOOK_MARKETING_COOKIE = "rirfit_facebook_oauth_marketing";
const GOOGLE_STATE_COOKIE = "rirfit_google_oauth_state";
const GOOGLE_REMEMBER_COOKIE = "rirfit_google_oauth_remember";
const facebookOAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 10 * 60 * 1000,
  path: "/api/auth/facebook",
});

const clearFacebookOAuthCookies = (res) => {
  const options = facebookOAuthCookieOptions();
  delete options.maxAge;
  res.clearCookie(FACEBOOK_STATE_COOKIE, options);
  res.clearCookie(FACEBOOK_REMEMBER_COOKIE, options);
  res.clearCookie(FACEBOOK_MARKETING_COOKIE, options);
};

const googleOAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 10 * 60 * 1000,
  path: "/api/auth/google",
});

const clearGoogleOAuthCookies = (res) => {
  const options = googleOAuthCookieOptions();
  delete options.maxAge;
  res.clearCookie(GOOGLE_STATE_COOKIE, options);
  res.clearCookie(GOOGLE_REMEMBER_COOKIE, options);
};

const getFacebookClientUrl = (req) => {
  const configured = String(process.env.FACEBOOK_CLIENT_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (configured) return configured;

  const hostname = String(req.hostname || "").toLowerCase();
  const isLocal =
    process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname));
  return isLocal ? `http://${hostname}:5173` : getClientUrl();
};

const facebookRedirect = (req, res, parameters = {}) => {
  const url = new URL(getFacebookClientUrl(req));
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return res.redirect(url.toString());
};

const googleRedirect = (res, parameters = {}) => {
  const url = new URL(getClientUrl());
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return res.redirect(303, url.toString());
};

const requestEmailVerification = asyncHandler(async (req, res) => {
  if (!isEmailConfigured()) {
    const err = new Error(
      "La verificación por correo no está configurada temporalmente.",
    );
    err.statusCode = 503;
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const user = await User.findOne({ email: req.body.email }).select(
    "+emailVerificationToken +emailVerificationExpiresAt",
  );
  if (!user || !user.emailVerificationRequired) {
    return res.json({ ok: true });
  }

  const previousToken = user.emailVerificationToken || null;
  const previousExpiration = user.emailVerificationExpiresAt || null;
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
  user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${getClientUrl()}/verificar-correo?token=${token}`;
  try {
    await sendVerificationEmail({
      email: user.email,
      name: user.name,
      verifyUrl,
    });
  } catch (error) {
    await User.findByIdAndUpdate(user._id, {
      emailVerificationToken: previousToken,
      emailVerificationExpiresAt: previousExpiration,
    });
    console.error("No se pudo reenviar el correo de verificación", error);
  }

  return res.json({ ok: true });
});

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
  const username = normalizeUsername(req.body.username);
  const accountName = String(name || "Atleta").trim() || "Atleta";
  const emailMarketingConsent = req.body.emailMarketingConsent === true;

  const existing = await User.findOne({
    $or: [{ email }, { username }],
  })
    .select("email username")
    .lean();
  if (existing?.email === email) {
    const err = new Error("El email ya está registrado");
    err.statusCode = 409;
    err.code = "EMAIL_TAKEN";
    throw err;
  }
  if (existing?.username === username) {
    const err = new Error("El nombre de usuario ya está en uso");
    err.statusCode = 409;
    err.code = "USERNAME_TAKEN";
    throw err;
  }

  const verificationRequired =
    isEmailConfigured() &&
    String(process.env.EMAIL_VERIFICATION_REQUIRED || "true").toLowerCase() !==
      "false";
  const verificationToken = verificationRequired
    ? crypto.randomBytes(32).toString("hex")
    : "";
  const coachInvitationToken = /^[A-Za-z0-9_-]{43}$/.test(
    String(req.body.coachInvitationToken || ""),
  )
    ? String(req.body.coachInvitationToken)
    : "";
  const user = await User.create({
    name: accountName,
    email,
    username,
    password,
    role: "Cliente",
    trainingMode: "independent",
    onboarding: { status: "pending", completedAt: null },
    emailPreferences: {
      productUpdates: emailMarketingConsent,
      consentedAt: emailMarketingConsent ? new Date() : null,
    },
    profile: {
      weight: null,
      height: null,
      goal: "mantenimiento",
      experienceLevel: "beginner",
      weeklyFrequency: 3,
    },
    emailVerificationRequired: verificationRequired,
    emailVerificationToken: verificationRequired
      ? crypto.createHash("sha256").update(verificationToken).digest("hex")
      : null,
    emailVerificationExpiresAt: verificationRequired
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : null,
  });

  if (verificationRequired) {
    const verifyUrl = `${getClientUrl()}/verificar-correo?token=${verificationToken}${
      coachInvitationToken
        ? `&invite=${encodeURIComponent(coachInvitationToken)}`
        : ""
    }`;
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
  res.set("Cache-Control", "no-store");
  res.status(201).json(authResponse(user, token));
});

const login = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const identifier = String(req.body.identifier || req.body.email || "").trim();
  const query = identifier.includes("@")
    ? { email: normalizeAuthEmail(identifier) }
    : { username: normalizeUsername(identifier) };
  const user = await User.findOne(query).select("+password");

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
  setAuthCookie(res, token, { persistent: req.body.remember === true });
  res.set("Cache-Control", "no-store");
  res.json(authResponse(user, token));
});

const facebookLogin = (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  const options = facebookOAuthCookieOptions();
  res.cookie(FACEBOOK_STATE_COOKIE, state, options);
  res.cookie(
    FACEBOOK_REMEMBER_COOKIE,
    req.query.remember === "1" ? "1" : "0",
    options,
  );
  if (["0", "1"].includes(req.query.marketing)) {
    res.cookie(FACEBOOK_MARKETING_COOKIE, req.query.marketing, options);
  }
  res.set("Cache-Control", "no-store");
  return res.redirect(createFacebookAuthorizationUrl(state));
};

const facebookCallback = async (req, res) => {
  const expectedState = String(req.cookies?.[FACEBOOK_STATE_COOKIE] || "");
  const suppliedState = String(req.query.state || "");
  const expectedStateBuffer = Buffer.from(expectedState);
  const suppliedStateBuffer = Buffer.from(suppliedState);
  const remember = req.cookies?.[FACEBOOK_REMEMBER_COOKIE] === "1";
  const marketingCookie = req.cookies?.[FACEBOOK_MARKETING_COOKIE];
  clearFacebookOAuthCookies(res);

  if (req.query.error) {
    return facebookRedirect(req, res, { facebook_error: "cancelled" });
  }
  if (
    !expectedState ||
    !suppliedState ||
    expectedStateBuffer.length !== suppliedStateBuffer.length ||
    !crypto.timingSafeEqual(expectedStateBuffer, suppliedStateBuffer)
  ) {
    return facebookRedirect(req, res, { facebook_error: "invalid_state" });
  }

  try {
    const identity = await verifyFacebookAuthorizationCode(req.query.code);
    let user = await User.findOne({
      facebookSubject: identity.subject,
    }).select(
      "+facebookSubject +emailVerificationToken +emailVerificationExpiresAt",
    );

    if (!user) {
      user = await User.findOne({ email: identity.email }).select(
        "+facebookSubject +emailVerificationToken +emailVerificationExpiresAt",
      );
    }

    if (user?.facebookSubject && user.facebookSubject !== identity.subject) {
      const conflict = new Error(
        "Este correo ya está asociado a otra cuenta de Facebook.",
      );
      conflict.code = "FACEBOOK_ACCOUNT_CONFLICT";
      throw conflict;
    }

    const hasMarketingConsent = ["0", "1"].includes(marketingCookie);
    const marketingConsent = marketingCookie === "1";

    if (!user) {
      try {
        user = await User.create({
          name: identity.name,
          email: identity.email,
          password: crypto.randomBytes(48).toString("base64url"),
          facebookSubject: identity.subject,
          role: "Cliente",
          trainingMode: "independent",
          onboarding: { status: "pending", completedAt: null },
          emailPreferences: {
            productUpdates: marketingConsent,
            consentedAt: marketingConsent ? new Date() : null,
          },
          profile: {
            weight: null,
            height: null,
            goal: "mantenimiento",
            experienceLevel: "beginner",
            weeklyFrequency: 3,
          },
          emailVerificationRequired: false,
          emailVerifiedAt: new Date(),
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        user = await User.findOne({ email: identity.email }).select(
          "+facebookSubject +emailVerificationToken +emailVerificationExpiresAt",
        );
        if (
          !user ||
          (user.facebookSubject && user.facebookSubject !== identity.subject)
        ) {
          const conflict = new Error(
            "No pudimos asociar esta cuenta de Facebook.",
          );
          conflict.code = "FACEBOOK_ACCOUNT_CONFLICT";
          throw conflict;
        }
      }
    }

    if (!user.isActive) throw invalidCredentials();

    const lastLoginAt = new Date();
    const session = createSession(req);
    const verifiedAt = user.emailVerifiedAt || lastLoginAt;
    const loginFields = {
      facebookSubject: identity.subject,
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLoginAt,
      emailVerificationRequired: false,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
      emailVerifiedAt: verifiedAt,
    };
    if (hasMarketingConsent) {
      loginFields["emailPreferences.productUpdates"] = marketingConsent;
      loginFields["emailPreferences.consentedAt"] = marketingConsent
        ? lastLoginAt
        : null;
    }
    await persistLoginSession(user._id, session, loginFields);

    const token = signToken(user, session.sessionId);
    setAuthCookie(res, token, { persistent: remember });
    res.set("Cache-Control", "no-store");
    return facebookRedirect(req, res, { facebook: "success" });
  } catch (error) {
    const allowedCodes = new Set([
      "FACEBOOK_AUTH_NOT_CONFIGURED",
      "FACEBOOK_EMAIL_REQUIRED",
      "FACEBOOK_ACCOUNT_CONFLICT",
      "INVALID_FACEBOOK_CREDENTIAL",
    ]);
    return facebookRedirect(req, res, {
      facebook_error: allowedCodes.has(error?.code)
        ? error.code.toLowerCase()
        : "login_failed",
    });
  }
};

const completeGoogleLogin = async (req) => {
  const identity = await verifyGoogleCredential(req.body.credential);
  const hasEmailMarketingConsent = Object.prototype.hasOwnProperty.call(
    req.body,
    "emailMarketingConsent",
  );
  const emailMarketingConsent = req.body.emailMarketingConsent === true;

  let user = await User.findOne({ googleSubject: identity.subject }).select(
    "+googleSubject +emailVerificationToken +emailVerificationExpiresAt",
  );

  if (!user) {
    user = await User.findOne({ email: identity.email }).select(
      "+googleSubject +emailVerificationToken +emailVerificationExpiresAt",
    );
  }

  if (user?.googleSubject && user.googleSubject !== identity.subject) {
    const error = new Error(
      "Este correo ya está asociado a otra cuenta de Google.",
    );
    error.statusCode = 409;
    error.code = "GOOGLE_ACCOUNT_CONFLICT";
    throw error;
  }

  if (!user) {
    try {
      user = await User.create({
        name: identity.name,
        email: identity.email,
        password: crypto.randomBytes(48).toString("base64url"),
        googleSubject: identity.subject,
        role: "Cliente",
        trainingMode: "independent",
        onboarding: { status: "pending", completedAt: null },
        emailPreferences: {
          productUpdates: emailMarketingConsent,
          consentedAt: emailMarketingConsent ? new Date() : null,
        },
        profile: {
          weight: null,
          height: null,
          goal: "mantenimiento",
          experienceLevel: "beginner",
          weeklyFrequency: 3,
        },
        emailVerificationRequired: false,
        emailVerifiedAt: new Date(),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      user = await User.findOne({ email: identity.email }).select(
        "+googleSubject +emailVerificationToken +emailVerificationExpiresAt",
      );
      if (
        !user ||
        (user.googleSubject && user.googleSubject !== identity.subject)
      ) {
        const conflict = new Error(
          "No pudimos asociar esta cuenta de Google. Intenta nuevamente.",
        );
        conflict.statusCode = 409;
        conflict.code = "GOOGLE_ACCOUNT_CONFLICT";
        throw conflict;
      }
    }
  }

  if (!user.isActive) throw invalidCredentials();

  const lastLoginAt = new Date();
  const session = createSession(req);
  const verifiedAt = user.emailVerifiedAt || lastLoginAt;
  const loginFields = {
    googleSubject: identity.subject,
    failedLoginAttempts: 0,
    lockUntil: null,
    lastLoginAt,
    emailVerificationRequired: false,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    emailVerifiedAt: verifiedAt,
  };
  if (hasEmailMarketingConsent) {
    loginFields["emailPreferences.productUpdates"] = emailMarketingConsent;
    loginFields["emailPreferences.consentedAt"] = emailMarketingConsent
      ? lastLoginAt
      : null;
  }
  await persistLoginSession(user._id, session, loginFields);

  user.googleSubject = identity.subject;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = lastLoginAt;
  user.emailVerificationRequired = false;
  user.emailVerificationToken = null;
  user.emailVerificationExpiresAt = null;
  user.emailVerifiedAt = verifiedAt;
  if (hasEmailMarketingConsent) {
    user.emailPreferences = {
      productUpdates: emailMarketingConsent,
      consentedAt: emailMarketingConsent ? lastLoginAt : null,
    };
  }

  const token = signToken(user, session.sessionId);
  return { token, user };
};

const googleLogin = asyncHandler(async (req, res) => {
  const { token, user } = await completeGoogleLogin(req);
  setAuthCookie(res, token, { persistent: req.body.remember === true });
  res.set("Cache-Control", "no-store");
  res.json(authResponse(user, token));
});

const googlePrepare = (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  const options = googleOAuthCookieOptions();
  res.cookie(GOOGLE_STATE_COOKIE, state, options);
  res.cookie(
    GOOGLE_REMEMBER_COOKIE,
    req.query.remember === "1" ? "1" : "0",
    options,
  );
  res.set("Cache-Control", "no-store");
  return res.json({ state });
};

const googleCallback = async (req, res) => {
  try {
    const expectedState = String(req.cookies?.[GOOGLE_STATE_COOKIE] || "");
    const suppliedState = String(req.body?.state || "");
    const expectedStateBuffer = Buffer.from(expectedState);
    const suppliedStateBuffer = Buffer.from(suppliedState);
    const remember = req.cookies?.[GOOGLE_REMEMBER_COOKIE] === "1";
    const csrfCookie = String(req.cookies?.g_csrf_token || "");
    const csrfBody = String(req.body?.g_csrf_token || "");
    const credential = String(req.body?.credential || "");
    clearGoogleOAuthCookies(res);

    if (
      !expectedState ||
      !suppliedState ||
      expectedStateBuffer.length !== suppliedStateBuffer.length ||
      !crypto.timingSafeEqual(expectedStateBuffer, suppliedStateBuffer)
    ) {
      return googleRedirect(res, { google_error: "invalid_state" });
    }
    if (csrfCookie && csrfBody && csrfCookie !== csrfBody) {
      return googleRedirect(res, { google_error: "invalid_csrf" });
    }
    if (credential.length < 100 || credential.length > 10000) {
      return googleRedirect(res, { google_error: "invalid_credential" });
    }

    const { token } = await completeGoogleLogin(req);
    setAuthCookie(res, token, { persistent: remember });
    res.set("Cache-Control", "no-store");
    return googleRedirect(res, { google: "success" });
  } catch (error) {
    const allowedCodes = new Set([
      "GOOGLE_AUTH_NOT_CONFIGURED",
      "GOOGLE_ACCOUNT_CONFLICT",
      "INVALID_GOOGLE_CREDENTIAL",
    ]);
    return googleRedirect(res, {
      google_error: allowedCodes.has(error?.code)
        ? error.code.toLowerCase()
        : "login_failed",
    });
  }
};

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
  res.set("Cache-Control", "no-store");
  res.json(authResponse(user, token));
});

const devAdminLogin = asyncHandler(async (req, res) => {
  if (!isDevelopmentAdminRouteEnabled()) {
    const err = new Error("Ruta no encontrada");
    err.statusCode = 404;
    throw err;
  }
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

  if (!isLocal) {
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

  const needsRepair =
    user.role !== "Admin" ||
    !user.isActive ||
    Number(user.failedLoginAttempts || 0) !== 0 ||
    Boolean(user.lockUntil);
  if (needsRepair) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          role: "Admin",
          isActive: true,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      },
    );
  }
  user.role = "Admin";
  user.isActive = true;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;

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
    await ensureShareableAvatarPhoto(req.user.id, req.body.avatarPhotoId);
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
    "experienceLevel",
    "weeklyFrequency",
    "calories",
    "units",
    "language",
    "privacy",
    "notifications",
    "avatarPhotoId",
  ];
  const payload = {};
  if (req.body.avatarPhotoId) {
    await ensureShareableAvatarPhoto(req.user.id, req.body.avatarPhotoId);
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

const completeOnboarding = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const usernameTaken = await User.exists({
    _id: { $ne: req.user.id },
    username,
  });
  if (usernameTaken) {
    const err = new Error("El nombre de usuario ya está en uso");
    err.statusCode = 409;
    err.code = "USERNAME_TAKEN";
    throw err;
  }
  const user = await User.findOneAndUpdate(
    { _id: req.user.id, role: "Cliente" },
    {
      $set: {
        name: req.body.name,
        username,
        "profile.goal": req.body.goal,
        "profile.experienceLevel": req.body.experienceLevel,
        "profile.weeklyFrequency": req.body.weeklyFrequency,
        "profile.weight": req.body.weight,
        "profile.height": req.body.height,
        "onboarding.accountType": "athlete",
        "onboarding.status": "complete",
        "onboarding.completedAt": new Date(),
      },
    },
    { new: true, runValidators: true },
  );
  if (!user) {
    const err = new Error("El onboarding solo esta disponible para atletas");
    err.statusCode = 403;
    throw err;
  }
  res.set("Cache-Control", "no-store");
  res.json({ user: sanitizeUser(user) });
});

const selectOnboardingAccountType = asyncHandler(async (req, res) => {
  const accountType = req.body.accountType;
  const nextRole = accountType === "coach" ? "Entrenador" : "Cliente";
  const user = await User.findOne({
    _id: req.user.id,
    role: { $in: ["Cliente", "Entrenador"] },
    "onboarding.status": "pending",
  });

  if (!user || user.assignedTrainerId) {
    const err = new Error(
      "Esta eleccion solo esta disponible durante la configuracion inicial",
    );
    err.statusCode = 403;
    err.code = "ACCOUNT_TYPE_SELECTION_UNAVAILABLE";
    throw err;
  }

  user.role = nextRole;
  user.trainingMode = "independent";
  user.onboarding.accountType = accountType;
  await user.save();

  res.set("Cache-Control", "no-store");
  res.json({ user: sanitizeUser(user) });
});

const completeCoachOnboarding = asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const usernameTaken = await User.exists({
    _id: { $ne: req.user.id },
    username,
  });
  if (usernameTaken) {
    const err = new Error("El nombre de usuario ya esta en uso");
    err.statusCode = 409;
    err.code = "USERNAME_TAKEN";
    throw err;
  }

  const user = await User.findOne({
    _id: req.user.id,
    role: "Entrenador",
    "onboarding.status": "pending",
    "onboarding.accountType": "coach",
  });
  if (!user) {
    const err = new Error(
      "La configuracion profesional ya no esta disponible para esta cuenta",
    );
    err.statusCode = 403;
    err.code = "COACH_ONBOARDING_UNAVAILABLE";
    throw err;
  }

  user.name = req.body.name.trim();
  user.username = username;
  user.coachCode = await ensureCoachCode(user._id);
  user.onboarding.status = "complete";
  user.onboarding.completedAt = new Date();
  await user.save();

  res.set("Cache-Control", "no-store");
  res.json({ user: sanitizeUser(user) });
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
  googleLogin,
  googlePrepare,
  googleCallback,
  facebookLogin,
  facebookCallback,
  demoLogin,
  demoStatus,
  verifyEmail,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  devAdminLogin,
  logout,
  me,
  getProfile,
  updateProfile,
  completeOnboarding,
  selectOnboardingAccountType,
  completeCoachOnboarding,
  getProfileSummary,
  updateAccount,
  updateSecurity,
  changePassword,
  getSessions,
  logoutAll,
};
