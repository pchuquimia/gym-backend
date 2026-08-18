export const SUBSCRIPTION_PLANS = Object.freeze([
  "free",
  "athlete_pro",
  "coach_pro",
]);

export const SUBSCRIPTION_STATUSES = Object.freeze([
  "active",
  "trialing",
  "expired",
  "canceled",
]);

export const PREMIUM_FEATURES = Object.freeze({
  DAILY_CHECKIN: "daily_checkin",
  COACH_PORTFOLIO: "coach_portfolio",
  COACH_ALERTS: "coach_alerts",
  WEEKLY_REPORTS: "weekly_reports",
  ASSISTED_PLANS: "assisted_plans",
  LOAD_RECOVERY: "load_recovery",
  EXERCISE_PROGRESSION: "exercise_progression",
});

const ALL_FEATURES = Object.freeze(Object.values(PREMIUM_FEATURES));

const FEATURES_BY_PLAN = Object.freeze({
  free: [],
  athlete_pro: [
    PREMIUM_FEATURES.DAILY_CHECKIN,
    PREMIUM_FEATURES.LOAD_RECOVERY,
    PREMIUM_FEATURES.EXERCISE_PROGRESSION,
  ],
  coach_pro: [
    PREMIUM_FEATURES.DAILY_CHECKIN,
    PREMIUM_FEATURES.COACH_PORTFOLIO,
    PREMIUM_FEATURES.COACH_ALERTS,
    PREMIUM_FEATURES.WEEKLY_REPORTS,
    PREMIUM_FEATURES.ASSISTED_PLANS,
    PREMIUM_FEATURES.LOAD_RECOVERY,
    PREMIUM_FEATURES.EXERCISE_PROGRESSION,
  ],
});

export const PLAN_CATALOG = Object.freeze({
  free: {
    id: "free",
    name: "Free",
    description: "Entrenamiento, rutinas y progreso esencial.",
    features: [
      "Registro de entrenamientos",
      "Rutinas y planificaciones basicas",
      "Historial y seguimiento de progreso",
    ],
  },
  athlete_pro: {
    id: "athlete_pro",
    name: "Athlete Pro",
    description: "Recuperacion diaria para entrenar con mejores decisiones.",
    features: [
      "Todo lo incluido en Free",
      "Check-in diario de recuperacion",
      "Puntuacion de preparacion",
      "Recomendacion diaria de carga",
      "Motor de carga y recuperacion",
      "Progresion inteligente por ejercicio",
    ],
  },
  coach_pro: {
    id: "coach_pro",
    name: "Coach Pro",
    description: "Control, alertas e informes para una cartera de atletas.",
    features: [
      "Todo lo incluido en Free",
      "Portfolio priorizado de atletas",
      "Alertas de adherencia y recuperacion",
      "Informes semanales",
      "Borradores asistidos de planificacion",
      "Motor de carga y recuperacion por atleta",
      "Progresion inteligente por ejercicio",
    ],
  },
});

const validDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getEffectiveSubscription = (user = {}, now = new Date()) => {
  const stored = user.subscription || {};
  const plan = SUBSCRIPTION_PLANS.includes(stored.plan) ? stored.plan : "free";
  const status = SUBSCRIPTION_STATUSES.includes(stored.status)
    ? stored.status
    : plan === "free"
      ? "active"
      : "expired";
  const trialEndsAt = validDate(stored.trialEndsAt);
  const currentPeriodEnd = validDate(stored.currentPeriodEnd);
  const trialActive =
    plan !== "free" &&
    status === "trialing" &&
    trialEndsAt &&
    trialEndsAt > now;
  const paidActive =
    plan !== "free" &&
    status === "active" &&
    (!currentPeriodEnd || currentPeriodEnd > now);
  const effectivePlan = trialActive || paidActive ? plan : "free";
  return {
    plan,
    status:
      plan !== "free" && status === "trialing" && !trialActive
        ? "expired"
        : plan !== "free" && status === "active" && !paidActive
          ? "expired"
          : status,
    effectivePlan,
    isPremium: effectivePlan !== "free",
    trialEndsAt: trialEndsAt?.toISOString() || null,
    currentPeriodEnd: currentPeriodEnd?.toISOString() || null,
    activatedAt: validDate(stored.activatedAt)?.toISOString() || null,
    canceledAt: validDate(stored.canceledAt)?.toISOString() || null,
    trialStartedAt: validDate(stored.trialStartedAt)?.toISOString() || null,
    trialUsedAt: validDate(stored.trialUsedAt)?.toISOString() || null,
    provider: stored.provider || "manual",
    grantedBy: stored.grantedBy || null,
  };
};

export const canStartPremiumTrial = (user = {}, now = new Date()) => {
  if (user.role === "Admin" || user.isDemo) return false;
  if (!["Cliente", "Entrenador"].includes(user.role)) return false;
  if (validDate(user.subscription?.trialUsedAt)) return false;
  return !getEffectiveSubscription(user, now).isPremium;
};

export const getEntitlements = (user = {}, now = new Date()) => {
  if (user.role === "Admin" || user.isDemo) return [...ALL_FEATURES];
  const { effectivePlan } = getEffectiveSubscription(user, now);
  if (effectivePlan === "coach_pro" && user.role !== "Entrenador") return [];
  if (effectivePlan === "athlete_pro" && user.role !== "Cliente") return [];
  return [...(FEATURES_BY_PLAN[effectivePlan] || [])];
};

export const hasPremiumFeature = (user, feature, now = new Date()) =>
  getEntitlements(user, now).includes(feature);

export const getPlanForRole = (role) =>
  role === "Entrenador"
    ? "coach_pro"
    : role === "Cliente"
      ? "athlete_pro"
      : "free";

export { ALL_FEATURES, FEATURES_BY_PLAN };
