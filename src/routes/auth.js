import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { login, logout, me, register } from "../controllers/authController.js";
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

export default router;
