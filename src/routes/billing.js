import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import User from "../models/User.js";
import {
  canStartPremiumTrial,
  getEffectiveSubscription,
  getEntitlements,
  getPlanForRole,
  PLAN_CATALOG,
} from "../utils/subscription.js";

const router = Router();
const TRIAL_DAYS = 14;
const DAY_MS = 86_400_000;

router.use(protect);

const visiblePlans = (user) => {
  if (user.role === "Admin") return Object.values(PLAN_CATALOG);
  const recommendedPlan = getPlanForRole(user.role);
  return [PLAN_CATALOG.free, PLAN_CATALOG[recommendedPlan]].filter(Boolean);
};

const billingSummary = (user) => ({
  subscription: getEffectiveSubscription(user),
  entitlements: getEntitlements(user),
  recommendedPlan: getPlanForRole(user.role),
  canStartTrial: canStartPremiumTrial(user),
  trialDays: TRIAL_DAYS,
  plans: visiblePlans(user),
});

router.get("/me", async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.set("Cache-Control", "private, no-store");
    res.json(billingSummary(user));
  } catch (error) {
    next(error);
  }
});

router.post("/trial", async (req, res, next) => {
  try {
    const current = await User.findById(req.user.id);
    if (!current)
      return res.status(404).json({ error: "Usuario no encontrado" });
    if (current.isDemo) {
      return res.status(400).json({
        error: "Las cuentas demo ya incluyen todas las funciones",
      });
    }
    const plan = getPlanForRole(current.role);
    if (plan === "free") {
      return res.status(400).json({
        error: "Esta cuenta ya incluye acceso administrativo completo",
      });
    }
    if (getEffectiveSubscription(current).isPremium) {
      return res
        .status(409)
        .json({ error: "La cuenta ya tiene Premium activo" });
    }
    if (!canStartPremiumTrial(current)) {
      return res.status(409).json({
        error: "La prueba gratuita ya fue utilizada en esta cuenta",
      });
    }

    const now = new Date();
    const user = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        isDemo: { $ne: true },
        $or: [
          { "subscription.trialUsedAt": null },
          { "subscription.trialUsedAt": { $exists: false } },
        ],
      },
      {
        $set: {
          "subscription.plan": plan,
          "subscription.status": "trialing",
          "subscription.trialEndsAt": new Date(
            now.getTime() + TRIAL_DAYS * DAY_MS,
          ),
          "subscription.currentPeriodEnd": null,
          "subscription.activatedAt": now,
          "subscription.canceledAt": null,
          "subscription.trialStartedAt": now,
          "subscription.trialUsedAt": now,
          "subscription.provider": "manual",
          "subscription.grantedBy": req.user.id,
        },
      },
      { new: true, runValidators: true },
    );
    if (!user) {
      return res.status(409).json({
        error: "La prueba gratuita ya fue utilizada en esta cuenta",
      });
    }

    res.set("Cache-Control", "private, no-store");
    res
      .status(201)
      .json({ user: user.toSafeJSON(), billing: billingSummary(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/cancel", async (req, res, next) => {
  try {
    const current = await User.findById(req.user.id);
    if (!current)
      return res.status(404).json({ error: "Usuario no encontrado" });
    if (current.role === "Admin" || current.isDemo) {
      return res.status(400).json({
        error: "Esta cuenta no necesita cancelar un plan Premium",
      });
    }
    if (!getEffectiveSubscription(current).isPremium) {
      return res
        .status(409)
        .json({ error: "La cuenta ya utiliza el plan Free" });
    }

    current.subscription.status = "canceled";
    current.subscription.canceledAt = new Date();
    await current.save();

    res.set("Cache-Control", "private, no-store");
    res.json({ user: current.toSafeJSON(), billing: billingSummary(current) });
  } catch (error) {
    next(error);
  }
});

export default router;
