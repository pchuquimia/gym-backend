import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import {
  changePassword,
  getProfile,
  getSessions,
  login,
  logout,
  logoutAll,
  me,
  register,
  updateProfile,
  updateSecurity,
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

router.use(authLimiter);

router.post(
  "/register",
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
  [
    emailRule(),
    body("password").isString().notEmpty().withMessage("Contrasena requerida"),
    validateLogin,
  ],
  login,
);

router.post("/logout", logout);
router.get("/me", protect, me);
router.get("/profile", protect, getProfile);
router.patch(
  "/profile",
  protect,
  [
    body("birthDate").optional().isString().withMessage("Fecha inválida"),
    body("weight").optional().isFloat({ min: 0 }).withMessage("Peso inválido"),
    body("height").optional().isFloat({ min: 0 }).withMessage("Altura inválida"),
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
    body("notifications").optional().isObject().withMessage("Notificaciones inválidas"),
    validate,
  ],
  updateProfile,
);
router.patch(
  "/security",
  protect,
  [
    body("biometricEnabled").optional().isBoolean().withMessage("Valor inválido"),
    body("twoFactorEnabled").optional().isBoolean().withMessage("Valor inválido"),
    validate,
  ],
  updateSecurity,
);
router.post(
  "/change-password",
  protect,
  [
    body("currentPassword").isString().notEmpty().withMessage("Contraseña actual requerida"),
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
