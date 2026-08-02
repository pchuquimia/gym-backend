import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import {
  changePassword,
  devAdminLogin,
  getProfile,
  getProfileSummary,
  getSessions,
  login,
  logout,
  logoutAll,
  me,
  register,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  updateAccount,
  updateSecurity,
  verifyEmail,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import { passwordRules, validate } from "../middleware/validate.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta mas tarde." },
});

const emailRule = () =>
  body("email").trim().isEmail().withMessage("Email invalido").normalizeEmail();

const validateLogin = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(401).json({ error: "Credenciales inválidas" });
};

router.post("/dev-admin", devAdminLogin);

router.post(
  "/register",
  authLimiter,
  [
    body("name")
      .trim()
      .isLength({ min: 2, max: 80 })
      .withMessage("Nombre invalido"),
    emailRule(),
    body("password")
      .isString()
      .matches(passwordRules.pattern)
      .withMessage(passwordRules.message),
    body("confirmPassword")
      .custom((value, { req }) => value === req.body.password)
      .withMessage("Las contrasenas no coinciden"),
    validate,
  ],
  register,
);

router.post(
  "/login",
  authLimiter,
  [
    emailRule(),
    body("password").isString().notEmpty().withMessage("Contrasena requerida"),
    validateLogin,
  ],
  login,
);
router.post(
  "/verify-email",
  authLimiter,
  [
    body("token").isString().notEmpty().withMessage("Token requerido"),
    validate,
  ],
  verifyEmail,
);

router.post(
  "/forgot-password",
  authLimiter,
  [emailRule(), validate],
  requestPasswordReset,
);
router.post(
  "/reset-password",
  authLimiter,
  [
    body("token").isString().notEmpty().withMessage("Token requerido"),
    body("password")
      .isString()
      .matches(passwordRules.pattern)
      .withMessage(passwordRules.message),
    body("confirmPassword")
      .custom((value, { req }) => value === req.body.password)
      .withMessage("Las contraseñas no coinciden"),
    validate,
  ],
  resetPassword,
);

router.post("/logout", logout);
router.get("/me", protect, me);
router.get("/profile", protect, getProfile);
router.get("/profile-summary", protect, getProfileSummary);
router.patch(
  "/account",
  protect,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 80 })
      .withMessage("Nombre inválido"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .withMessage("Email inválido")
      .normalizeEmail(),
    body("birthDate").optional().isString().withMessage("Fecha inválida"),
    body("weight")
      .optional({ nullable: true })
      .isFloat({ min: 20, max: 500 })
      .withMessage("Peso inválido"),
    body("height")
      .optional({ nullable: true })
      .isFloat({ min: 80, max: 250 })
      .withMessage("Altura inválida"),
    body("avatarPhotoId")
      .optional()
      .isString()
      .withMessage("Foto de perfil inválida"),
    validate,
  ],
  updateAccount,
);
router.patch(
  "/profile",
  protect,
  [
    body("birthDate").optional().isString().withMessage("Fecha inválida"),
    body("weight")
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage("Peso inválido"),
    body("height")
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage("Altura inválida"),
    body("goal")
      .optional()
      .isIn(["volumen", "mantenimiento", "definicion"])
      .withMessage("Objetivo inválido"),
    body("calories")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Calorías inválidas"),
    body("units")
      .optional()
      .isIn(["metric", "imperial"])
      .withMessage("Unidades inválidas"),
    body("privacy")
      .optional()
      .isIn(["público", "privado"])
      .withMessage("Privacidad inválida"),
    body("notifications")
      .optional()
      .isObject()
      .withMessage("Notificaciones inválidas"),
    body("avatarPhotoId")
      .optional()
      .isString()
      .withMessage("Foto de perfil inválida"),
    validate,
  ],
  updateProfile,
);
router.patch(
  "/security",
  protect,
  [
    body("biometricEnabled")
      .optional()
      .isBoolean()
      .withMessage("Valor inválido"),
    body("twoFactorEnabled")
      .optional()
      .isBoolean()
      .withMessage("Valor inválido"),
    validate,
  ],
  updateSecurity,
);
router.post(
  "/change-password",
  protect,
  [
    body("currentPassword")
      .isString()
      .notEmpty()
      .withMessage("Contraseña actual requerida"),
    body("password")
      .isString()
      .matches(passwordRules.pattern)
      .withMessage(passwordRules.message),
    body("confirmPassword")
      .custom((value, { req }) => value === req.body.password)
      .withMessage("Las contraseñas no coinciden"),
    validate,
  ],
  changePassword,
);
router.get("/sessions", protect, getSessions);
router.post("/logout-all", protect, logoutAll);

export default router;
