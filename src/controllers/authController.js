import jwt from "jsonwebtoken";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookies.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;

const signToken = (user) =>
  jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.COOKIE_EXPIRES || "7d",
    },
  );

const sanitizeUser = (user) =>
  typeof user.toSafeJSON === "function" ? user.toSafeJSON() : user;

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

  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user: sanitizeUser(user) });
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
  await user.save();

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: sanitizeUser(user) });
});

const logout = asyncHandler(async (_req, res) => {
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
  res.set("Cache-Control", "no-store");
  res.json({ user: sanitizeUser(user) });
});

export { register, login, logout, me };
