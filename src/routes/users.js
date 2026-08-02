import { Router } from "express";
import { body } from "express-validator";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import User, { USER_ROLES } from "../models/User.js";

const router = Router();
const ADMIN_USER_FIELDS =
  "name email role isActive assignedTrainerId createdAt updatedAt";
const CLIENT_DIRECTORY_FIELDS = "name role isActive assignedTrainerId";

router.use(protect);

router.get("/", authorizeRoles("Admin"), async (_req, res, next) => {
  try {
    const users = await User.find({}, ADMIN_USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.set("Cache-Control", "no-store");
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/clients",
  authorizeRoles("Entrenador", "Admin"),
  async (req, res, next) => {
    try {
      const filter =
        req.user.role === "Admin"
          ? { role: "Cliente" }
          : { role: "Cliente", assignedTrainerId: req.user.id, isActive: true };
      const users = await User.find(filter, CLIENT_DIRECTORY_FIELDS)
        .sort({ name: 1 })
        .lean();
      res.set("Cache-Control", "no-store");
      res.json(users);
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  authorizeRoles("Admin"),
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
      .normalizeEmail()
      .withMessage("Email inválido"),
    body("role").optional().isIn(USER_ROLES).withMessage("Rol inválido"),
    body("isActive").optional().isBoolean().withMessage("Estado inválido"),
    body("assignedTrainerId")
      .optional({ nullable: true })
      .isString()
      .withMessage("Entrenador inválido"),
    validate,
  ],
  async (req, res, next) => {
    try {
      const allowed = [
        "name",
        "email",
        "role",
        "isActive",
        "assignedTrainerId",
      ];
      const payload = {};
      allowed.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(req.body, key))
          payload[key] = req.body[key];
      });
      const user = await User.findByIdAndUpdate(req.params.id, payload, {
        new: true,
        runValidators: true,
      }).select(ADMIN_USER_FIELDS);
      if (!user) return res.status(404).json({ error: "Not found" });
      res.json(user);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
